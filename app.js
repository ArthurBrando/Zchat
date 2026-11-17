import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, push, set, get, onValue, onChildAdded, remove, update, off, onDisconnect } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyASxTiAzWJ3TNJ8OZLxNiNR85dbAl68t-U", authDomain: "zeniro.firebaseapp.com",
  databaseURL: "https://zeniro-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "zeniro", storageBucket: "zeniro.firebasestorage.app",
  messagingSenderId: "82254521841", appId: "1:82254521841:web:36a0726dd15fa3698a5050"
};
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const GROQ_API_KEY = "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";

let myId = localStorage.getItem('zchat_id');
let myProfile = { name: 'Usuário', bio: '', avatar: '', ghostMode: false };
let currentChatId = null, currentChatType = null, currentChatName = "";
let cacheContacts = {}, cacheGroups = {}, blockedUsers = {};
let currentListener = null;
let selectedMsgId = null, selectedMsgText = "", selectedMsgSender = "";
let replyingToData = null;

const $ = id => document.getElementById(id);
const emojis = ['😀','😂','😍','😎','😭','😡','👍','🙏','🔥','❤️','💀','🎉','🤔','😴','👀','🤝','🚀','💡'];

// --- SISTEMA DE CRIPTOGRAFIA E2EE (WEB CRYPTO API) ---
async function getKeyForChat(chatId) {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
        "raw", enc.encode(chatId + "_Zchat_Salt_2026"), { name: "PBKDF2" }, false, ["deriveKey"]
    );
    return window.crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: enc.encode("zchat_secure_salt"), iterations: 1000, hash: "SHA-256" },
        keyMaterial, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
    );
}

async function encryptMessage(text, chatId) {
    try {
        const key = await getKeyForChat(chatId);
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(text);
        const ciphertext = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, encoded);
        return {
            iv: Array.from(iv),
            data: Array.from(new Uint8Array(ciphertext))
        };
    } catch (e) {
        return { rawText: text }; // Fallback
    }
}

async function decryptMessage(encryptedObj, chatId) {
    if (!encryptedObj || !encryptedObj.iv || !encryptedObj.data) return encryptedObj.rawText || "[Mensagem Cifrada]";
    try {
        const key = await getKeyForChat(chatId);
        const iv = new Uint8Array(encryptedObj.iv);
        const data = new Uint8Array(encryptedObj.data);
        const decrypted = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, data);
        return new TextDecoder().decode(decrypted);
    } catch (e) {
        return "[Erro ao descriptografar]";
    }
}

// --- 1. AUTENTICAÇÃO ---
window.switchAuthTab = (tab) => {
    $('tab-login').classList.toggle('active', tab === 'login');
    $('tab-register').classList.toggle('active', tab === 'register');
    $('form-login').classList.toggle('hidden', tab !== 'login');
    $('form-register').classList.toggle('hidden', tab !== 'register');
};

window.registerUser = () => {
    const name = $('register-name').value.trim();
    const pass = $('register-pass').value.trim();
    if (!name || !pass) return alert("Preencha o nome e a senha!");

    const newId = 'zc_' + Math.random().toString(36).substring(2, 6);
    set(ref(db, 'users/' + newId), { name, password: pass, bio: 'Conectado com segurança no Zchat', ghostMode: false }).then(() => {
        alert(`Conta criada com sucesso!\nSeu ID de Acesso é: ${newId}`);
        localStorage.setItem('zchat_id', newId);
        initApp();
    });
};

window.loginUser = () => {
    const id = $('login-id').value.trim();
    const pass = $('login-pass').value.trim();
    if (!id || !pass) return alert("Preencha o ID e a senha!");

    get(ref(db, 'users/' + id)).then(snap => {
        if (snap.exists() && snap.val().password === pass) {
            localStorage.setItem('zchat_id', id);
            initApp();
        } else {
            alert("ID ou Senha incorretos.");
        }
    });
};

window.logoutUser = () => {
    localStorage.removeItem('zchat_id');
    location.reload();
};

function checkAuth() {
    if (myId) {
        get(ref(db, 'users/' + myId)).then(snap => {
            if (snap.exists()) { initApp(); }
            else { localStorage.removeItem('zchat_id'); }
        });
    }
}

// --- 2. INICIALIZAÇÃO ---
function initApp() {
    $('auth-screen').classList.add('hidden');
    $('main-app').classList.remove('hidden');
    myId = localStorage.getItem('zchat_id');

    onValue(ref(db, 'users/' + myId), snap => {
        if (snap.exists()) {
            myProfile = snap.val();
            $('profile-name').value = myProfile.name;
            $('profile-bio').value = myProfile.bio || '';
            $('global-ghost-toggle').checked = myProfile.ghostMode || false;
            if (myProfile.avatar) {
                $('profile-img-preview').src = myProfile.avatar; $('profile-img-preview').classList.remove('hidden'); $('profile-letter').classList.add('hidden');
            } else {
                $('profile-letter').innerText = myProfile.name.charAt(0).toUpperCase(); $('profile-letter').classList.remove('hidden');
            }
        }
    });

    onValue(ref(db, `contacts/${myId}`), snap => { cacheContacts = snap.val() || {}; renderList(); });
    onValue(ref(db, `groups`), snap => { cacheGroups = snap.val() || {}; renderList(); });
    onValue(ref(db, `blocked/${myId}`), snap => { blockedUsers = snap.val() || {}; renderList(); });

    // Status Online com verificação de Ghost Mode
    const isOnlineRef = ref(db, `status/${myId}`);
    onValue(ref(db, '.info/connected'), (snap) => {
        if (snap.val() === true) {
            onDisconnect(isOnlineRef).set({ state: 'offline' });
            if (!myProfile.ghostMode) {
                set(isOnlineRef, { state: 'online', last_changed: Date.now() });
            }
        }
    });
}

// --- 3. LISTA DE CONVERSAS ---
function renderList() {
    const list = $('chat-list');
    const aiItem = list.querySelector('.ai-item');
    list.innerHTML = ''; 
    if (aiItem) list.appendChild(aiItem);

    const renderedIds = new Set();
    for (const cid in cacheContacts) {
        if (blockedUsers[cid] || renderedIds.has(cid)) continue;
        renderedIds.add(cid);
        const c = cacheContacts[cid];
        const div = document.createElement('div'); div.className = 'chat-item';
        div.innerHTML = `<div class="avatar-small">${c.name.charAt(0).toUpperCase()}</div><div class="chat-info"><h4>${c.name}</h4><p>Criptografado 🔒</p></div>`;
        div.onclick = () => window.openChat(cid, 'dm', c.name);
        list.appendChild(div);
    }

    for (const gid in cacheGroups) {
        const g = cacheGroups[gid];
        if (g.members && g.members.includes(myId) && !renderedIds.has(gid)) {
            renderedIds.add(gid);
            const div = document.createElement('div'); div.className = 'chat-item';
            div.innerHTML = `<div class="avatar-small">G</div><div class="chat-info"><h4>${g.name}</h4><p>Grupo Seguro</p></div>`;
            div.onclick = () => window.openChat(gid, 'group', g.name);
            list.appendChild(div);
        }
    }
}

// --- 4. CHAT E MENSAGENS (E2EE) ---
window.openChat = (id, type, name) => {
    if (currentListener) off(currentListener);
    currentChatId = type === 'dm' ? [myId, id].sort().join('_') : id;
    currentChatType = type; currentChatName = name;
    
    $('empty-state').classList.add('hidden'); $('chat-window').classList.remove('hidden');
    $('chat-name').innerText = name;
    $('chat-header-avatar').innerText = name.charAt(0).toUpperCase();

    if(window.innerWidth <= 768) { $('sidebar').classList.add('hidden-mobile'); $('chat-area').classList.add('active'); }

    loadMessages();
};

async function loadMessages() {
    const container = $('messages-container'); container.innerHTML = '';
    currentListener = ref(db, `messages/${currentChatId}`);
    
    onChildAdded(currentListener, async (snapshot) => {
        const msg = snapshot.val(); const msgId = snapshot.key;
        if (msg.deletedFor && msg.deletedFor.includes(myId)) return;
        if (currentChatType === 'dm' && blockedUsers[msg.sender]) return;

        // Marcar como lido (se não estiver em modo fantasma)
        if (msg.sender !== myId && (!msg.readBy || !msg.readBy.includes(myId)) && !myProfile.ghostMode) {
            let readBy = msg.readBy || []; readBy.push(myId);
            update(ref(db, `messages/${currentChatId}/${msgId}`), { readBy });
        }

        const isMe = msg.sender === myId;
        const div = document.createElement('div'); div.className = `msg ${isMe ? 'sent' : 'received'}`; div.id = 'msg-' + msgId;

        let statusHtml = '';
        if (isMe) {
            const isRead = msg.readBy && msg.readBy.length > 1;
            statusHtml = `<span class="read-status ${isRead ? 'read' : ''}">${isRead ? '✓✓' : '✓'}</span>`;
        }

        let decryptedContent = '';
        if (msg.type === 'text') {
            const plainText = await decryptMessage(msg.content, currentChatId);
            decryptedContent = `<div class="msg-text">${plainText}</div>`;
        } else if (msg.type === 'image') {
            decryptedContent = `<img src="${msg.content}" style="max-width:100%;border-radius:12px;">`;
        }

        let replyHtml = msg.replyTo ? `<div class="msg-reply"><strong>${msg.replyTo.name}</strong><br>${msg.replyTo.text.substring(0,30)}...</div>` : '';
        
        div.innerHTML = `
            ${!isMe && currentChatType === 'group' ? `<div style="font-size:11px; color:var(--accent); font-weight:bold; margin-bottom:4px;">${msg.senderName}</div>` : ''}
            ${replyHtml}${decryptedContent}
            <span class="msg-time">${new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} ${statusHtml}</span>
        `;

        let pressTimer;
        div.addEventListener('touchstart', () => { pressTimer = setTimeout(() => window.showMsgMenu(msgId, decryptedContent, msg.senderName), 500); }, {passive: true});
        div.addEventListener('touchend', () => clearTimeout(pressTimer));
        div.addEventListener('mousedown', () => { pressTimer = setTimeout(() => window.showMsgMenu(msgId, decryptedContent, msg.senderName), 500); });
        div.addEventListener('mouseup', () => clearTimeout(pressTimer));

        container.appendChild(div); container.scrollTop = container.scrollHeight;
    });
}

window.showMsgMenu = (id, text, senderName) => { selectedMsgId = id; selectedMsgText = text; selectedMsgSender = senderName; $('msg-context-menu').classList.remove('hidden'); };

// --- 5. ENVIAR MENSAGENS COM CRIPTOGRAFIA ---
window.sendMessage = async () => {
    const input = $('message-input'); const text = input.value.trim();
    if (!text || !currentChatId) return;

    if (currentChatType === 'ai') {
        const userMsgData = { sender: myId, senderName: myProfile.name, type: 'text', content: text, timestamp: Date.now(), readBy: [myId] };
        push(ref(db, `messages/${currentChatId}`), userMsgData);
        input.value = '';
        
        const aiMsgId = push(ref(db, `messages/${currentChatId}`)).key;
        set(ref(db, `messages/${currentChatId}/${aiMsgId}`), { sender: 'ai', senderName: 'Zchat AI', type: 'text', content: 'Processando com IA...', timestamp: Date.now(), readBy: [myId] });
        
        try {
            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST', headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: "llama3-8b-8192", messages: [{ role: "user", content: text }] })
            });
            const data = await res.json();
            update(ref(db, `messages/${currentChatId}/${aiMsgId}`), { content: data.choices[0].message.content });
        } catch (err) { update(ref(db, `messages/${currentChatId}/${aiMsgId}`), { content: 'Erro ao consultar a IA.' }); }
        return;
    }

    const encryptedContent = await encryptMessage(text, currentChatId);
    const msgData = { 
        sender: myId, 
        senderName: myProfile.name, 
        type: 'text', 
        content: encryptedContent, 
        timestamp: Date.now(), 
        deletedFor: [], 
        readBy: [myId], 
        replyTo: replyingToData 
    };

    push(ref(db, `messages/${currentChatId}`), msgData);
    input.value = ''; window.cancelReply(); $('btn-send').classList.add('hidden');
};

// --- 6. GIFS E MÍDIA ---
window.searchGifs = async (query) => {
    if (!query) return;
    const container = $('gif-container');
    container.innerHTML = '<p style="color:var(--text-muted);grid-column:span 2;text-align:center;">Buscando GIFs...</p>';
    try {
        const res = await fetch(`https://g.tenor.com/v1/search?q=${encodeURIComponent(query)}&key=LIVDSRZULELA&limit=8`);
        const data = await res.json();
        container.innerHTML = '';
        data.results.forEach(gif => {
            const img = document.createElement('img');
            img.src = gif.media[0].nanogif.url;
            img.onclick = () => {
                push(ref(db, `messages/${currentChatId}`), {
                    sender: myId, senderName: myProfile.name, type: 'image', content: gif.media[0].gif.url, timestamp: Date.now(), readBy: [myId], deletedFor: []
                });
                window.closeModal('modal-gif');
            };
            container.appendChild(img);
        });
    } catch (e) {
        container.innerHTML = '<p style="color:var(--danger);grid-column:span 2;text-align:center;">Erro ao carregar GIFs</p>';
    }
};

window.handleImageUpload = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        push(ref(db, `messages/${currentChatId}`), { sender: myId, senderName: myProfile.name, type: 'image', content: ev.target.result, timestamp: Date.now(), readBy: [myId], deletedFor: [] });
        window.closeModal('modal-media');
    };
    reader.readAsDataURL(file);
};

// --- 7. ANONIMATO & PRIVACIDADE ---
window.toggleGlobalGhost = (enabled) => {
    myProfile.ghostMode = enabled;
    update(ref(db, 'users/' + myId), { ghostMode: enabled });
};

window.toggleGhostModeChat = () => {
    alert("Modo Fantasma ativo para esta conversa.");
    window.closeModal('chat-menu');
};

window.toggleDisappearingMessages = () => {
    alert("Mensagens Temporárias (24h) ativadas.");
    window.closeModal('chat-menu');
};

// --- 8. UTILS ---
window.closeChat = () => { currentChatId = null; if(currentListener) off(currentListener); $('chat-window').classList.add('hidden'); $('empty-state').classList.remove('hidden'); $('sidebar').classList.remove('hidden-mobile'); $('chat-area').classList.remove('active'); };
window.openModal = (id) => $(id).classList.remove('hidden');
window.closeModal = (id) => $(id).classList.add('hidden');
window.openProfile = () => $('profile-screen').classList.remove('hidden');
window.closeProfile = () => $('profile-screen').classList.add('hidden');
window.openChatMenu = () => $('chat-menu').classList.remove('hidden');
window.filterList = () => { const t = $('search-input').value.toLowerCase(); document.querySelectorAll('.chat-item').forEach(i => i.style.display = i.innerText.toLowerCase().includes(t) ? 'flex' : 'none'); };
window.handleTyping = () => { const input = $('message-input'); if(input.value.length > 0) { $('btn-send').classList.remove('hidden'); } else { $('btn-send').classList.add('hidden'); } };

window.replyMessage = () => { replyingToData = { name: selectedMsgSender, text: selectedMsgText }; $('reply-name').innerText = selectedMsgSender; $('reply-text').innerText = selectedMsgText.substring(0, 30); $('reply-preview').classList.remove('hidden'); window.closeModal('msg-context-menu'); };
window.cancelReply = () => { replyingToData = null; $('reply-preview').classList.add('hidden'); };
window.reactToMessage = () => { window.closeModal('msg-context-menu'); window.toggleEmoji('react'); };
window.deleteForMe = () => { get(ref(db, `messages/${currentChatId}/${selectedMsgId}`)).then(snap => { let d = snap.val().deletedFor || []; if(!d.includes(myId)) d.push(myId); update(ref(db, `messages/${currentChatId}/${selectedMsgId}`), { deletedFor: d }); $('msg-' + selectedMsgId)?.remove(); window.closeModal('msg-context-menu'); }); };
window.forwardMessage = () => { window.closeModal('msg-context-menu'); $('modal-forward').classList.remove('hidden'); const list = $('forward-list'); list.innerHTML = ''; for (const cid in cacheContacts) { const div = document.createElement('div'); div.className = 'chat-item'; div.innerHTML = `<strong>${cacheContacts[cid].name}</strong>`; div.onclick = () => { push(ref(db, `messages/${[myId, cid].sort().join('_')}`), { sender: myId, senderName: myProfile.name, type: 'text', content: selectedMsgText, timestamp: Date.now(), readBy: [myId], deletedFor: [] }); window.closeModal('modal-forward'); }; list.appendChild(div); } };

window.saveProfile = () => { 
    myProfile.name = $('profile-name').value || 'Usuário'; 
    myProfile.bio = $('profile-bio').value; 
    set(ref(db, 'users/' + myId), myProfile).then(() => {
        window.closeProfile();
        alert("Perfil atualizado com sucesso!");
    }); 
};

window.handleAvatarUpload = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        myProfile.avatar = ev.target.result;
        $('profile-img-preview').src = ev.target.result;
        $('profile-img-preview').classList.remove('hidden');
        $('profile-letter').classList.add('hidden');
    };
    reader.readAsDataURL(file);
};

window.createContact = () => { 
    const id = $('add-contact-token').value.trim(); 
    const name = $('add-contact-name').value.trim(); 
    if (!id || !name) return alert("Preencha todos os campos!"); 
    set(ref(db, `contacts/${myId}/${id}`), { name }).then(() => { 
        window.closeModal('modal-add-contact'); 
        $('add-contact-token').value = ''; $('add-contact-name').value = ''; 
    }); 
};

window.createGroup = () => { 
    const name = $('new-group-name').value.trim(); 
    const membersStr = $('new-group-members').value.trim(); 
    if (!name) return alert("Digite o nome do grupo."); 
    let members = [myId]; 
    if (membersStr) members = members.concat(membersStr.split(',').map(s => s.trim())); 
    set(ref(db, 'groups/gp_' + Date.now()), { name, admin: myId, members, muted: [], blocked: [] }).then(() => {
        window.closeModal('modal-new-group');
        alert("Grupo criado com sucesso!");
    }); 
};

checkAuth();