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
let myProfile = { name: 'Usuário', bio: '', avatar: '', font: "'Inter', sans-serif" };
let currentChatId = null, currentChatType = null, currentChatTargetId = null, currentChatName = "";
let cacheContacts = {}, cacheGroups = {}, blockedUsers = {};
let currentListener = null;
let selectedMsgId = null, selectedMsgText = "", selectedMsgSender = "";
let replyingToData = null;

const $ = id => document.getElementById(id);
const emojis = ['😀','😂','😍','😎','😭','😡','👍','🙏','🔥','❤️','💀','🎉','🤔','😴','👀','🤝'];

// --- 1. SISTEMA DE LOGIN E REGISTRO ---
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
    set(ref(db, 'users/' + newId), { name, password: pass, bio: 'Olá, estou no Zchat!' }).then(() => {
        alert(`Sua conta foi criada!\nSeu ID é: ${newId}\nGuarde-o para fazer login.`);
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

// --- 2. INICIALIZAÇÃO DO APP ---
function initApp() {
    $('auth-screen').classList.add('hidden');
    $('main-app').classList.remove('hidden');
    myId = localStorage.getItem('zchat_id');

    onValue(ref(db, 'users/' + myId), snap => {
        if (snap.exists()) {
            myProfile = snap.val();
            $('profile-name').value = myProfile.name;
            $('profile-bio').value = myProfile.bio || '';
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

    // Status Online
    const isOnlineRef = ref(db, `status/${myId}`);
    onValue(ref(db, '.info/connected'), (snap) => {
        if (snap.val() === true) {
            onDisconnect(isOnlineRef).set({ state: 'offline', last_changed: Date.now() });
            set(isOnlineRef, { state: 'online', last_changed: Date.now() });
        }
    });
}

// --- 3. LISTA DE CONVERSAS ---
function renderList() {
    const list = $('chat-list');
    const aiBtn = list.querySelector('.ai-item');
    list.innerHTML = ''; list.appendChild(aiBtn);

    const renderedIds = new Set();
    for (const cid in cacheContacts) {
        if (blockedUsers[cid] || renderedIds.has(cid)) continue;
        renderedIds.add(cid);
        const c = cacheContacts[cid];
        const div = document.createElement('div'); div.className = 'chat-item';
        div.innerHTML = `<div class="avatar-small">${c.name.charAt(0).toUpperCase()}</div><div class="chat-info"><h4>${c.name}</h4><p>Toque para conversar</p></div>`;
        div.onclick = () => window.openChat(cid, 'dm', c.name, cid);
        list.appendChild(div);
    }

    for (const gid in cacheGroups) {
        const g = cacheGroups[gid];
        if (g.members && g.members.includes(myId) && !g.blocked?.includes(myId) && !renderedIds.has(gid)) {
            renderedIds.add(gid);
            const div = document.createElement('div'); div.className = 'chat-item';
            div.innerHTML = `<div class="avatar-small">G</div><div class="chat-info"><h4>${g.name}</h4><p>Grupo</p></div>`;
            div.onclick = () => window.openChat(gid, 'group', g.name, gid);
            list.appendChild(div);
        }
    }
}

// --- 4. CHAT E MENSAGENS ---
window.openChat = (id, type, name, targetId) => {
    if (currentListener) off(currentListener);
    currentChatId = type === 'dm' ? [myId, id].sort().join('_') : id;
    currentChatType = type; currentChatName = name; currentChatTargetId = targetId;
    
    $('empty-state').classList.add('hidden'); $('chat-window').classList.remove('hidden');
    $('chat-name').innerText = name;
    $('chat-header-avatar').innerText = name.charAt(0).toUpperCase();

    if(window.innerWidth <= 768) { $('sidebar').classList.add('hidden-mobile'); $('chat-area').classList.add('active'); }

    loadMessages();
    listenTyping();

    if (type === 'group') {
        get(ref(db, 'groups/' + id)).then(snap => {
            const g = snap.val();
            if (g.muted && g.muted.includes(myId)) {
                $('input-bar').innerHTML = '<p style="color:var(--danger); text-align:center; width:100%; font-weight:bold;">Você está mutado neste grupo.</p>';
            } else { $('input-bar').innerHTML = '<input type="text" id="message-input" placeholder="Mensagem..." oninput="window.handleTyping()"><button class="icon-btn hidden" id="btn-send" onclick="window.sendMessage()">➤</button>'; }
        });
    }
};

function loadMessages() {
    const container = $('messages-container'); container.innerHTML = '';
    currentListener = ref(db, `messages/${currentChatId}`);
    
    onChildAdded(currentListener, (snapshot) => {
        const msg = snapshot.val(); const msgId = snapshot.key;
        if (msg.deletedFor && msg.deletedFor.includes(myId)) return;
        if (currentChatType === 'dm' && blockedUsers[msg.sender]) return;

        if (msg.sender !== myId && (!msg.readBy || !msg.readBy.includes(myId))) {
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

        let content = msg.type === 'text' ? `<div class="msg-text">${msg.content}</div>` : msg.type === 'image' ? `<img src="${msg.content}" style="max-width:100%;border-radius:8px;">` : `<audio controls src="${msg.content}"></audio>`;
        let replyHtml = msg.replyTo ? `<div class="msg-reply"><strong>${msg.replyTo.name}</strong><br>${msg.replyTo.text.substring(0,30)}...</div>` : '';
        
        let reactionsHtml = '';
        if (msg.reactions) {
            reactionsHtml = `<div class="msg-reactions">`;
            for (const [emoji, users] of Object.entries(msg.reactions)) {
                if (users.length > 0) reactionsHtml += `<span class="reaction-badge">${emoji} ${users.length}</span>`;
            }
            reactionsHtml += `</div>`;
        }

        div.innerHTML = `
            ${!isMe && currentChatType === 'group' ? `<div style="font-size:12px; color:#aaa; font-weight:bold;">${msg.senderName}</div>` : ''}
            ${replyHtml}${content}${reactionsHtml}
            <span class="msg-time">${new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} ${statusHtml}</span>
        `;

        let pressTimer;
        div.addEventListener('touchstart', (e) => { pressTimer = setTimeout(() => { if (e.cancelable) e.preventDefault(); window.showMsgMenu(msgId, msg.content, msg.senderName); }, 500); }, {passive: false});
        div.addEventListener('touchend', () => clearTimeout(pressTimer));
        div.addEventListener('mousedown', () => { pressTimer = setTimeout(() => window.showMsgMenu(msgId, msg.content, msg.senderName), 500); });
        div.addEventListener('mouseup', () => clearTimeout(pressTimer));

        container.appendChild(div); container.scrollTop = container.scrollHeight;
    });
}

window.showMsgMenu = (id, text, senderName) => { selectedMsgId = id; selectedMsgText = text; selectedMsgSender = senderName; $('msg-context-menu').classList.remove('hidden'); };

// --- 5. AÇÕES E ENVIOS ---
window.sendMessage = async () => {
    const input = $('message-input'); const text = input.value.trim();
    if (!text || !currentChatId) return;

    let finalText = text;
    if (currentChatType === 'group') finalText = text.replace(/@(\w+)/g, '<span class="mention">@$1</span>');

    const msgData = { sender: myId, senderName: myProfile.name, type: 'text', content: finalText, rawText: text, timestamp: Date.now(), deletedFor: [], readBy: [myId], replyTo: replyingToData };

    if (currentChatType === 'ai') {
        push(ref(db, `messages/${currentChatId}`), msgData);
        input.value = ''; window.cancelReply();
        const aiMsgId = push(ref(db, `messages/${currentChatId}`)).key;
        set(ref(db, `messages/${currentChatId}/${aiMsgId}`), { sender: 'ai', senderName: 'Zchat AI', type: 'text', content: 'Pensando...', timestamp: Date.now(), readBy: [myId] });
        
        try {
            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST', headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: "llama3-8b-8192", messages: [{ role: "user", content: text }] })
            });
            const data = await res.json();
            update(ref(db, `messages/${currentChatId}/${aiMsgId}`), { content: data.choices[0].message.content });
        } catch (err) { update(ref(db, `messages/${currentChatId}/${aiMsgId}`), { content: 'Erro na IA.' }); }
        return;
    }

    push(ref(db, `messages/${currentChatId}`), msgData);
    input.value = ''; window.cancelReply();
};

// --- 6. MENUS E EMOJIS ---
let emojiMode = 'msg';
window.toggleEmoji = (mode) => {
    emojiMode = mode; const panel = $('emoji-picker'); panel.classList.toggle('hidden');
    if (panel.classList.contains('hidden')) return;
    const grid = $('emoji-grid'); grid.innerHTML = '';
    emojis.forEach(e => {
        const span = document.createElement('span'); span.innerText = e;
        span.onclick = () => {
            if (emojiMode === 'react') {
                get(ref(db, `messages/${currentChatId}/${selectedMsgId}/reactions/${e}`)).then(snap => {
                    let users = snap.val() || []; if(!users.includes(myId)) users.push(myId); else users = users.filter(u => u !== myId);
                    set(ref(db, `messages/${currentChatId}/${selectedMsgId}/reactions/${e}`), users);
                });
            } else { $('message-input').value += e; }
            panel.classList.add('hidden');
        };
        grid.appendChild(span);
    });
};

window.replyMessage = () => { replyingToData = { name: selectedMsgSender, text: selectedMsgText }; $('reply-name').innerText = selectedMsgSender; $('reply-text').innerText = selectedMsgText.substring(0, 30); $('reply-preview').classList.remove('hidden'); window.closeModal('msg-context-menu'); };
window.cancelReply = () => { replyingToData = null; $('reply-preview').classList.add('hidden'); };
window.reactToMessage = () => { window.closeModal('msg-context-menu'); window.toggleEmoji('react'); };
window.deleteForMe = () => { get(ref(db, `messages/${currentChatId}/${selectedMsgId}`)).then(snap => { let d = snap.val().deletedFor || []; if(!d.includes(myId)) d.push(myId); update(ref(db, `messages/${currentChatId}/${selectedMsgId}`), { deletedFor: d }); $('msg-' + selectedMsgId)?.remove(); window.closeModal('msg-context-menu'); }); };
window.forwardMessage = () => { window.closeModal('msg-context-menu'); $('modal-forward').classList.remove('hidden'); const list = $('forward-list'); list.innerHTML = ''; for (const cid in cacheContacts) { const div = document.createElement('div'); div.className = 'chat-item'; div.innerHTML = `<strong>${cacheContacts[cid].name}</strong>`; div.onclick = () => { push(ref(db, `messages/${[myId, cid].sort().join('_')}`), { sender: myId, senderName: myProfile.name, type: 'text', content: selectedMsgText, timestamp: Date.now(), readBy: [myId], deletedFor: [] }); window.closeModal('modal-forward'); }; list.appendChild(div); } };

// --- 7. PERFIL, GRUPOS E MÍDIA ---
window.saveProfile = () => { myProfile.name = $('profile-name').value || 'Usuário'; myProfile.bio = $('profile-bio').value; myProfile.avatar = $('profile-avatar-url').value; myProfile.font = $('profile-font').value; set(ref(db, 'users/' + myId), myProfile).then(() => window.closeProfile()); };
window.createContact = () => { const id = $('add-contact-token').value.trim(); const name = $('add-contact-name').value.trim(); if (!id || !name) return alert("Preencha tudo!"); set(ref(db, `contacts/${myId}/${id}`), { name }).then(() => { window.closeModal('modal-add-contact'); $('add-contact-token').value = ''; $('add-contact-name').value = ''; }); };
window.createGroup = () => { const name = $('new-group-name').value.trim(); const membersStr = $('new-group-members').value.trim(); if (!name) return alert("Digite o nome."); let members = [myId]; if (membersStr) members = members.concat(membersStr.split(',').map(s => s.trim())); set(ref(db, 'groups/gp_' + Date.now()), { name, admin: myId, members, muted: [], blocked: [] }).then(() => window.closeModal('modal-new-group')); };
window.handleImageUpload = (e) => { const file = e.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = (ev) => { push(ref(db, `messages/${currentChatId}`), { sender: myId, senderName: myProfile.name, type: 'image', content: ev.target.result, timestamp: Date.now(), readBy: [myId], deletedFor: [] }); window.closeModal('modal-media'); }; reader.readAsDataURL(file); };

// --- 8. UTILS ---
window.closeChat = () => { currentChatId = null; if(currentListener) off(currentListener); $('chat-window').classList.add('hidden'); $('empty-state').classList.remove('hidden'); $('sidebar').classList.remove('hidden-mobile'); $('chat-area').classList.remove('active'); };
window.openModal = (id) => { $(id).classList.remove('hidden'); };
window.closeModal = (id) => $(id).classList.add('hidden');
window.openProfile = () => $('profile-screen').classList.remove('hidden');
window.closeProfile = () => $('profile-screen').classList.add('hidden');
window.filterList = () => { const t = $('search-input').value.toLowerCase(); document.querySelectorAll('.chat-item').forEach(i => i.style.display = i.innerText.toLowerCase().includes(t) ? 'flex' : 'none'); };
window.handleTyping = () => { if(!currentChatId) return; const input = $('message-input'); if(input.value.length > 0) { $('btn-send').classList.remove('hidden'); } else { $('btn-send').classList.add('hidden'); } };

// Verifica se já está logado ao abrir a página
checkAuth();