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

let myId = localStorage.getItem('zchat_id') || 'zc_' + Math.random().toString(36).substring(2, 6);
localStorage.setItem('zchat_id', myId);
let myProfile = { name: 'Usuário', bio: '', avatar: '', banner: '', font: "'Inter', sans-serif" };
let currentChatId = null, currentChatType = null, currentChatTargetId = null, currentChatName = "";
let cacheContacts = {}, cacheGroups = {}, blockedUsers = {};
let currentListener = null; // Para evitar duplicação de mensagens
let selectedMsgId = null, selectedMsgText = "", selectedMsgSender = "";
let replyingToData = null;
let msgToForward = null;

const $ = id => document.getElementById(id);
const emojis = ['😀','😂','😍','😎','😭','😡','👍','🙏','🔥','❤️','💀','🎉'];

// 1. INICIALIZAÇÃO E PRESENÇA
$('my-token').innerText = myId;
if ("Notification" in window) Notification.requestPermission();

const userRef = ref(db, 'users/' + myId);
onValue(userRef, snap => {
    if (snap.exists()) myProfile = snap.val();
    else set(userRef, myProfile);
    updateProfileUI();
});

// Status Online
const isOnlineRef = ref(db, `status/${myId}`);
onValue(ref(db, '.info/connected'), (snap) => {
    if (snap.val() === true) {
        onDisconnect(isOnlineRef).set({ state: 'offline', last_changed: Date.now() });
        set(isOnlineRef, { state: 'online', last_changed: Date.now() });
    }
});

function updateProfileUI() {
    $('profile-name').value = myProfile.name;
    $('profile-bio').value = myProfile.bio || '';
    $('profile-avatar-url').value = myProfile.avatar || '';
    $('profile-banner-url').value = myProfile.banner || '';
    $('profile-font').value = myProfile.font || "'Inter', sans-serif";
    if (myProfile.avatar) {
        $('profile-img-preview').src = myProfile.avatar; $('profile-img-preview').classList.remove('hidden'); $('profile-letter').classList.add('hidden');
    } else {
        $('profile-letter').innerText = myProfile.name.charAt(0).toUpperCase(); $('profile-img-preview').classList.add('hidden'); $('profile-letter').classList.remove('hidden');
    }
}

// 2. CONTATOS E SIDEBAR (Anti-Duplicação)
function renderList() {
    const list = $('chat-list');
    const aiBtn = list.querySelector('.ai-item');
    list.innerHTML = ''; list.appendChild(aiBtn);

    const renderedIds = new Set();
    for (const cid in cacheContacts) {
        if (blockedUsers[cid] || renderedIds.has(cid)) continue;
        renderedIds.add(cid);
        const c = cacheContacts[cid];
        const div = document.createElement('div');
        div.className = 'chat-item';
        div.innerHTML = `<div class="avatar-small">${c.name.charAt(0).toUpperCase()}</div><div class="chat-info"><h4>${c.name}</h4><p>Toque para conversar</p></div>`;
        div.onclick = () => window.openChat(cid, 'dm', c.name, cid);
        list.appendChild(div);
    }

    for (const gid in cacheGroups) {
        const g = cacheGroups[gid];
        if (g.members && g.members.includes(myId) && !g.blocked?.includes(myId) && !renderedIds.has(gid)) {
            renderedIds.add(gid);
            const div = document.createElement('div');
            div.className = 'chat-item';
            div.innerHTML = `<div class="avatar-small">G</div><div class="chat-info"><h4>${g.name}</h4><p>Grupo</p></div>`;
            div.onclick = () => window.openChat(gid, 'group', g.name, gid);
            list.appendChild(div);
        }
    }
}
onValue(ref(db, `contacts/${myId}`), snap => { cacheContacts = snap.val() || {}; renderList(); });
onValue(ref(db, `groups`), snap => { cacheGroups = snap.val() || {}; renderList(); });
onValue(ref(db, `blocked/${myId}`), snap => { blockedUsers = snap.val() || {}; renderList(); });

// 3. ABRIR CHAT E MENSAGENS
window.openChat = (id, type, name, targetId) => {
    if (currentListener) off(currentListener); // Remove o listener antigo para não duplicar
    currentChatId = type === 'dm' ? [myId, id].sort().join('_') : id;
    currentChatType = type; currentChatName = name; currentChatTargetId = targetId;
    
    $('empty-state').classList.add('hidden'); $('chat-window').classList.remove('hidden');
    $('chat-name').innerText = name;
    $('chat-header-avatar').innerText = name.charAt(0).toUpperCase();
    if(myProfile.avatar) $('chat-header-avatar').innerHTML = `<img src="${myProfile.avatar}" style="width:100%;height:100%;object-fit:cover;">`;

    if(window.innerWidth <= 768) { $('sidebar').classList.add('hidden-mobile'); $('chat-area').classList.add('active'); }

    loadMessages();
    listenTyping();

    // Verifica se está mutado no grupo
    if (type === 'group') {
        get(ref(db, 'groups/' + id)).then(snap => {
            const g = snap.val();
            if (g.muted && g.muted.includes(myId)) {
                $('input-bar').innerHTML = '<p style="color:var(--danger); text-align:center; width:100%; font-weight:bold;">Você está mutado neste grupo.</p>';
            } else {
                $('input-bar').innerHTML = `<button class="icon-btn" onclick="window.toggleEmoji('msg')"><svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"/></svg></button><input type="text" id="message-input" placeholder="Mensagem..." oninput="window.handleTyping()"><button class="icon-btn" onclick="window.openModal('modal-gif')"><span style="font-weight:800; font-size:14px;">GIF</span></button><button class="icon-btn" onclick="window.openModal('modal-media')"><svg viewBox="0 0 24 24"><path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg></button><button class="icon-btn hidden" id="btn-send" onclick="window.sendMessage()"><svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button><button class="icon-btn" id="btn-mic" onclick="window.toggleRecord()"><svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/></svg></button>`;
            }
        });
    }
};

function loadMessages() {
    const container = $('messages-container');
    container.innerHTML = '';
    currentListener = ref(db, `messages/${currentChatId}`);
    
    onChildAdded(currentListener, (snapshot) => {
        const msg = snapshot.val();
        const msgId = snapshot.key;
        if (msg.deletedFor && msg.deletedFor.includes(myId)) return;
        if (currentChatType === 'dm' && blockedUsers[msg.sender]) return;

        // Marcar como lido
        if (msg.sender !== myId && (!msg.readBy || !msg.readBy.includes(myId))) {
            let readBy = msg.readBy || [];
            readBy.push(myId);
            update(ref(db, `messages/${currentChatId}/${msgId}`), { readBy });
        }

        const isMe = msg.sender === myId;
        const div = document.createElement('div');
        div.className = `msg ${isMe ? 'sent' : 'received'}`;
        div.id = 'msg-' + msgId;

        // Status de Leitura
        let statusHtml = '';
        if (isMe) {
            const isRead = msg.readBy && msg.readBy.length > 1;
            statusHtml = `<span class="read-status ${isRead ? 'read' : ''}">${isRead ? '✓✓' : '✓'}</span>`;
        }

        let content = msg.type === 'text' ? `<div class="msg-text">${msg.content}</div>` : 
                      msg.type === 'image' ? `<img src="${msg.content}" style="max-width:100%;border-radius:8px;">` : 
                      `<audio controls src="${msg.content}"></audio>`;
                      
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

        // Segurar para opções
        let pressTimer;
        div.addEventListener('touchstart', (e) => {
            pressTimer = setTimeout(() => {
                if (e.cancelable) e.preventDefault();
                window.showMsgMenu(msgId, msg.content, msg.senderName);
            }, 500);
        }, {passive: false});
        div.addEventListener('touchend', () => clearTimeout(pressTimer));
        div.addEventListener('mousedown', () => { pressTimer = setTimeout(() => window.showMsgMenu(msgId, msg.content, msg.senderName), 500); });
        div.addEventListener('mouseup', () => clearTimeout(pressTimer));

        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    });
}

window.showMsgMenu = (id, text, senderName) => {
    selectedMsgId = id; selectedMsgText = text; selectedMsgSender = senderName;
    $('msg-context-menu').classList.remove('hidden');
};

// 4. ENVIO, MENÇÕES E GROQ AI
window.sendMessage = async () => {
    const input = $('message-input');
    const text = input.value.trim();
    if (!text || !currentChatId) return;

    let finalText = text;
    // Sistema de Menção em Grupos
    if (currentChatType === 'group') {
        // Transforma @nome em destaque visual
        finalText = text.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
    }

    const msgData = {
        sender: myId, senderName: myProfile.name, type: 'text', content: finalText, rawText: text,
        timestamp: Date.now(), deletedFor: [], readBy: [myId], replyTo: replyingToData
    };

    if (currentChatType === 'ai') {
        push(ref(db, `messages/${currentChatId}`), msgData);
        input.value = ''; $('btn-send').classList.add('hidden'); $('btn-mic').classList.remove('hidden');
        window.cancelReply();
        // Chamar Groq
        const aiMsgId = push(ref(db, `messages/${currentChatId}`)).key;
        set(ref(db, `messages/${currentChatId}/${aiMsgId}`), { sender: 'ai', senderName: 'Zchat AI', type: 'text', content: 'Pensando...', timestamp: Date.now(), readBy: [myId] });
        
        try {
            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: "llama3-8b-8192", messages: [{ role: "user", content: text }] })
            });
            const data = await res.json();
            update(ref(db, `messages/${currentChatId}/${aiMsgId}`), { content: data.choices[0].message.content });
        } catch (err) {
            update(ref(db, `messages/${currentChatId}/${aiMsgId}`), { content: 'Erro ao conectar com a IA.' });
        }
        return;
    }

    push(ref(db, `messages/${currentChatId}`), msgData);
    if (currentChatType === 'dm') {
        const otherUser = currentChatId.split('_').find(id => id !== myId);
        get(ref(db, `contacts/${otherUser}/${myId}`)).then(snap => { if (!snap.exists()) set(ref(db, `contacts/${otherUser}/${myId}`), { name: myProfile.name }); });
    }

    input.value = ''; $('btn-send').classList.add('hidden'); $('btn-mic').classList.remove('hidden');
    window.cancelReply(); clearTyping();
};