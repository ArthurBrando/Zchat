import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, push, set, get, onValue, onChildAdded, remove, update, onDisconnect } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyASxTiAzWJ3TNJ8OZLxNiNR85dbAl68t-U",
  authDomain: "zeniro.firebaseapp.com",
  databaseURL: "https://zeniro-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "zeniro",
  storageBucket: "zeniro.firebasestorage.app",
  messagingSenderId: "82254521841",
  appId: "1:82254521841:web:36a0726dd15fa3698a5050"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

let myId = localStorage.getItem('zchat_id');
let myProfile = { name: 'Usuário', bio: '', avatar: '', wallpaper: '' };
let currentChatId = null;
let currentChatType = null;
let mediaRecorder = null;
let audioChunks = [];
let localStream = null;
let peerConnection = null;
let typingTimeout = null;
let tempAvatarBase64 = null;

const $ = id => document.getElementById(id);

// Emojis Categorizados
const emojis = {
    "😀": ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯'],
    "👍": ['👍','👎','👊','✌️','🤞','🖐️','✋','🤚','👋','🤙','💪','🙏','🤝','👏','🙌','👐','🤲','🤜','🤛','✊','👌'],
    "🎮": ['🎮','🎲','🎯','🏆','⚽','🏀','🎸','🎧','🎤','💻','📱','💡','🔥','❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💯','💢','💥','💫','💦','💨','💣','💬','💤']
};

// 1. INICIALIZAÇÃO
if (!myId) {
    myId = 'zc_' + Math.random().toString(36).substring(2, 6);
    localStorage.setItem('zchat_id', myId);
}

$('my-token').innerText = myId;
$('modal-token').innerText = myId;

get(ref(db, 'users/' + myId)).then(snap => {
    if (snap.exists()) {
        myProfile = snap.val();
        updateProfileUI();
    } else {
        myProfile.name = 'Usuário ' + myId;
        set(ref(db, 'users/' + myId), myProfile);
        updateProfileUI();
    }
});

function updateProfileUI() {
    $('my-name').innerText = myProfile.name;
    $('set-name').value = myProfile.name;
    $('set-bio').value = myProfile.bio || '';
    $('set-avatar-url').value = myProfile.avatar || '';
    $('set-wallpaper').value = myProfile.wallpaper || '';
    
    if (myProfile.avatar) {
        $('my-avatar-img').src = myProfile.avatar;
        $('my-avatar-img').style.display = 'block';
        $('my-avatar-letter').style.display = 'none';
        
        $('preview-avatar-img').src = myProfile.avatar;
        $('preview-avatar-img').style.display = 'block';
        $('preview-avatar-letter').style.display = 'none';
    } else {
        $('my-avatar-letter').innerText = myProfile.name.charAt(0).toUpperCase();
        $('my-avatar-img').style.display = 'none';
        $('my-avatar-letter').style.display = 'block';
        
        $('preview-avatar-letter').innerText = myProfile.name.charAt(0).toUpperCase();
        $('preview-avatar-img').style.display = 'none';
        $('preview-avatar-letter').style.display = 'block';
    }

    if (myProfile.wallpaper) {
        $('main-chat').style.backgroundImage = `url(${myProfile.wallpaper})`;
        $('main-chat').style.backgroundColor = '#000';
    } else {
        $('main-chat').style.backgroundImage = 'none';
        $('main-chat').style.backgroundColor = 'var(--chat-bg)';
    }
}

// 2. SIDEBAR (CONTATOS E GRUPOS)
function renderSidebar() {
    const list = $('chat-list');
    list.innerHTML = '';

    onValue(ref(db, `contacts/${myId}`), snap => {
        list.innerHTML = '';
        if (snap.exists()) {
            const contacts = snap.val();
            for (const cid in contacts) {
                const c = contacts[cid];
                const div = document.createElement('div');
                div.className = 'chat-item';
                div.innerHTML = `<div class="avatar">${c.name.charAt(0).toUpperCase()}</div><div class="chat-item-info"><h4>${c.name}</h4><p>Toque para conversar</p></div>`;
                div.onclick = () => window.openChat(cid, 'dm', c.name);
                list.appendChild(div);
            }
        }
        
        get(ref(db, `groups`)).then(gSnap => {
            if (gSnap.exists()) {
                const groups = gSnap.val();
                for (const gid in groups) {
                    const g = groups[gid];
                    if (g.members && g.members.includes(myId)) {
                        const div = document.createElement('div');
                        div.className = 'chat-item';
                        div.innerHTML = `<div class="avatar">G</div><div class="chat-item-info"><h4>${g.name}</h4><p>Grupo</p></div>`;
                        div.onclick = () => window.openChat(gid, 'group', g.name);
                        list.appendChild(div);
                    }
                }
            }
        });
    });
}
renderSidebar();

// 3. CHAT E MENSAGENS
window.openChat = (id, type, name) => {
    currentChatId = type === 'dm' ? [myId, id].sort().join('_') : id;
    currentChatType = type;
    
    $('empty-state').classList.add('hidden');
    $('chat-window').classList.remove('hidden');
    $('chat-title').innerText = name;
    
    if(window.innerWidth <= 768) {
        $('sidebar').classList.add('hidden-mobile');
        $('main-chat').classList.add('active');
    }

    loadMessages();
    listenTyping(id);
};

window.closeChat = () => {
    currentChatId = null;
    $('chat-window').classList.add('hidden');
    $('empty-state').classList.remove('hidden');
    $('sidebar').classList.remove('hidden-mobile');
    $('main-chat').classList.remove('active');
    if(typingTimeout) clearTimeout(typingTimeout);
};

function loadMessages() {
    const container = $('messages-container');
    container.innerHTML = '';
    
    onChildAdded(ref(db, `messages/${currentChatId}`), (snapshot) => {
        const msg = snapshot.val();
        if (msg.deletedFor && msg.deletedFor.includes(myId)) return;

        const isMe = msg.sender === myId;
        const div = document.createElement('div');
        div.className = `msg ${isMe ? 'sent' : 'received'}`;
        
        let content = '';
        if (msg.type === 'text') content = `<div class="msg-text">${msg.content}</div>`;
        else if (msg.type === 'image') content = `<img src="${msg.content}">`;
        else if (msg.type === 'audio') content = `<audio controls src="${msg.content}" style="max-width:100%; margin-top:5px;"></audio>`;

        div.innerHTML = `
            ${!isMe && currentChatType === 'group' ? `<div style="font-size:11px; color:var(--text-muted); margin-bottom:4px; font-weight:bold;">${msg.senderName}</div>` : ''}
            ${content}
            <span class="msg-time">${new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
        `;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    });
}

window.sendMessage = () => {
    const input = $('message-input');
    const text = input.value.trim();
    if (!text || !currentChatId) return;

    push(ref(db, `messages/${currentChatId}`), {
        sender: myId,
        senderName: myProfile.name,
        type: 'text',
        content: text,
        timestamp: Date.now(),
        deletedFor: []
    });
    input.value = '';
    $('send-btn').classList.add('hidden');
    $('record-btn').classList.remove('hidden');
    clearTyping();
};

// 4. DIGITANDO ANIMADO
window.handleTyping = () => {
    const input = $('message-input');
    if (!currentChatId) return;

    if (input.value.length > 0) {
        $('send-btn').classList.remove('hidden');
        $('record-btn').classList.add('hidden');
    } else {
        $('send-btn').classList.add('hidden');
        $('record-btn').classList.remove('hidden');
        clearTyping();
        return;
    }

    set(ref(db, `typing/${currentChatId}/${myId}`), true);
    
    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        clearTyping();
    }, 2000);
};

function clearTyping() {
    if (currentChatId) remove(ref(db, `typing/${currentChatId}/${myId}`));
}

function listenTyping(targetId) {
    onValue(ref(db, `typing/${currentChatId}`), (snap) => {
        const typers = snap.val() || {};
        let isSomeoneTyping = false;
        for (const t in typers) {
            if (t !== myId) isSomeoneTyping = true;
        }

        if (isSomeoneTyping) {
            $('typing-indicator').classList.remove('hidden');
        } else {
            $('typing-indicator').classList.add('hidden');
        }
    });
}

// 5. EMOJIS
window.toggleEmoji = () => {
    const panel = $('emoji-panel');
    panel.classList.toggle('hidden');
    
    if (panel.classList.contains('hidden')) return;
    
    const cats = $('emoji-cats');
    const grid = $('emoji-grid');
    
    if (cats.innerHTML === '') {
        let first = true;
        for (const [key, list] of Object.entries(emojis)) {
            const span = document.createElement('span');
            span.innerText = key;
            span.onclick = () => renderEmojis(list);
            cats.appendChild(span);
            
            if (first) { renderEmojis(list); first = false; }
        }
    }
};

function renderEmojis(list) {
    const grid = $('emoji-grid');
    grid.innerHTML = '';
    list.forEach(e => {
        const span = document.createElement('span');
        span.innerText = e;
        span.onclick = () => { $('message-input').value += e; window.handleTyping(); };
        grid.appendChild(span);
    });
}

// 6. PERFIL E UPLOADS
window.openSettings = () => {
    window.openModal('settings-modal');
};

$('set-avatar-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // Se for GIF, não comprime
    if (file.type === 'image/gif') {
        const reader = new FileReader();
        reader.onload = (ev) => { tempAvatarBase64 = ev.target.result; updatePreviewAvatar(tempAvatarBase64); };
        reader.readAsDataURL(file);
    } else {
        // Se for imagem, comprime
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => {
                const canvas = $('resize-canvas');
                const ctx = canvas.getContext('2d');
                let width = img.width, height = img.height;
                const MAX = 400; 
                if (width > height && width > MAX) { height *= MAX / width; width = MAX; }
                else if (height > MAX) { width *= MAX / height; height = MAX; }
                canvas.width = width; canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);
                tempAvatarBase64 = canvas.toDataURL('image/jpeg', 0.8);
                updatePreviewAvatar(tempAvatarBase64);
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    }
});

function updatePreviewAvatar(src) {
    $('preview-avatar-img').src = src;
    $('preview-avatar-img').style.display = 'block';
    $('preview-avatar-letter').style.display = 'none';
}

window.saveProfile = () => {
    const name = $('set-name').value || 'Usuário';
    const bio = $('set-bio').value;
    const avatarUrl = $('set-avatar-url').value;
    const wallpaper = $('set-wallpaper').value;

    const finalAvatar = tempAvatarBase64 || avatarUrl;

    myProfile = { name, bio, avatar: finalAvatar, wallpaper };
    
    set(ref(db, 'users/' + myId), myProfile).then(() => {
        updateProfileUI();
        window.closeModal('settings-modal');
        tempAvatarBase64 = null;
    });
};

// 7. UPLOAD DE MÍDIA (CHAT)
window.handleImage = (e) => {
    const file = e.target.files[0];
    if (!file || !currentChatId) return;
    window.closeModal('media-modal');

    if (file.type === 'image/gif') {
        const reader = new FileReader();
        reader.onload = (ev) => sendMedia(ev.target.result, 'image');
        reader.readAsDataURL(file);
    } else {
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => {
                const canvas = $('resize-canvas');
                const ctx = canvas.getContext('2d');
                let width = img.width, height = img.height;
                const MAX = 800;
                if (width > height && width > MAX) { height *= MAX / width; width = MAX; }
                else if (height > MAX) { width *= MAX / height; height = MAX; }
                canvas.width = width; canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);
                sendMedia(canvas.toDataURL('image/jpeg', 0.7), 'image');
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    }
    e.target.value = '';
};

function sendMedia(content, type) {
    push(ref(db, `messages/${currentChatId}`), {
        sender: myId, senderName: myProfile.name, type: type,
        content: content, timestamp: Date.now(), deletedFor: []
    });
}

// 8. ÁUDIO
window.toggleRecord = async () => {
    const btn = $('record-btn');
    
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        btn.classList.remove('recording');
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
        mediaRecorder.onstop = () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            const reader = new FileReader();
            reader.onload = (ev) => sendMedia(ev.target.result, 'audio');
            reader.readAsDataURL(audioBlob);
            stream.getTracks().forEach(t => t.stop());
        };

        mediaRecorder.start();
        btn.classList.add('recording');
    } catch (err) { alert("Erro ao acessar microfone: " + err.message); }
};

// 9. CONTATOS E GRUPOS
window.addContact = () => {
    const id = $('contact-id-input').value.trim();
    const name = $('contact-name-input').value.trim();
    if (!id || !name) return alert("Preencha tudo!");

    get(ref(db, 'users/' + id)).then(snap => {
        if (snap.exists()) {
            set(ref(db, `contacts/${myId}/${id}`), { name: name }).then(() => {
                window.closeModal('add-contact-modal');
                $('contact-id-input').value = '';
                $('contact-name-input').value = '';
            });
        } else {
            alert("ID não encontrado no Zchat.");
        }
    });
};

window.createGroup = () => {
    const name = $('group-name-input').value.trim();
    const membersStr = $('group-members-input').value.trim();
    if (!name) return alert("Digite o nome do grupo.");
    
    let members = [myId];
    if (membersStr) {
        const ids = membersStr.split(',').map(s => s.trim());
        members = members.concat(ids);
    }

    const gid = 'gp_' + Date.now();
    set(ref(db, 'groups/' + gid), {
        name: name,
        admin: myId,
        members: members,
        blocked: [],
        muted: []
    }).then(() => {
        window.closeModal('group-modal');
        $('group-name-input').value = '';
        $('group-members-input').value = '';
    });
};

// 10. WEBRTC (CHAMADAS BÁSICAS)
window.startCall = async (type) => {
    if(!currentChatId) return;
    const callId = currentChatId;
    
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: type === 'video', audio: true });
        $('local-video').srcObject = localStream;
        $('call-overlay').classList.remove('hidden');
        
        peerConnection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));
        
        peerConnection.onicecandidate = (e) => { if (e.candidate) push(ref(db, `calls/${callId}/candidates`), e.candidate.toJSON()); };
        peerConnection.ontrack = (e) => { $('remote-video').srcObject = e.streams[0]; };

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        set(ref(db, `calls/${callId}/offer`), { offer, caller: myId });

    } catch (err) { alert("Erro ao iniciar chamada: " + err.message); }
};

window.toggleMic = () => { const t = localStream.getAudioTracks()[0]; t.enabled = !t.enabled; $('btn-mic').style.opacity = t.enabled ? '1' : '0.5'; };
window.toggleVideo = () => { const t = localStream.getVideoTracks()[0]; if(t) { t.enabled = !t.enabled; $('btn-cam').style.opacity = t.enabled ? '1' : '0.5'; } };
window.endCall = () => {
    if (peerConnection) peerConnection.close();
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    $('call-overlay').classList.add('hidden');
    if(currentChatId) remove(ref(db, `calls/${currentChatId}`));
    peerConnection = null; localStream = null;
};

// Utilitários Globais
window.openModal = (id) => $(id).classList.remove('hidden');
window.closeModal = (id) => $(id).classList.add('hidden');
window.resetToken = () => {
    if(confirm("Isso apagará seus contatos e histórico. Continuar?")) {
        localStorage.removeItem('zchat_id');
        location.reload();
    }
};
window.filterChats = () => {
    const term = $('search-chat').value.toLowerCase();
    const items = document.querySelectorAll('.chat-item');
    items.forEach(item => {
        const name = item.querySelector('h4').innerText.toLowerCase();
        item.style.display = name.includes(term) ? 'flex' : 'none';
    });
};