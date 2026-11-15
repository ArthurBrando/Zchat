import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, push, set, get, onValue, onChildAdded, remove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

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
let myProfile = { name: 'Usuário', bio: '', avatar: '' };
let currentChatId = null;
let currentChatType = null;
let mediaRecorder = null;
let audioChunks = [];
let localStream = null;
let peerConnection = null;
let typingTimeout = null;

// Cache local para evitar piscar a tela
let cacheContacts = {};
let cacheGroups = {};

const $ = id => document.getElementById(id);

const emojis = ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','👍','👎','👊','✌️','🤞','🖐️','✋','🤚','👋','🤙','💪','🙏','🎮','🎲','🎯','🏆','⚽','🏀','🎸','🎧','🎤','💻','📱','💡','🔥','❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💯','💢','💥','💫','💦','💨','💣','💬','💤'];

// --- 1. INICIALIZAÇÃO E PERFIL ---
if (!myId) {
    myId = 'zc_' + Math.random().toString(36).substring(2, 6);
    localStorage.setItem('zchat_id', myId);
}

$('my-token').innerText = myId;

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
    $('profile-name').value = myProfile.name;
    $('profile-bio').value = myProfile.bio || '';
    
    if (myProfile.avatar) {
        $('profile-img-preview').src = myProfile.avatar;
        $('profile-img-preview').classList.remove('hidden');
        $('profile-letter').classList.add('hidden');
    } else {
        $('profile-letter').innerText = myProfile.name.charAt(0).toUpperCase();
        $('profile-img-preview').classList.add('hidden');
        $('profile-letter').classList.remove('hidden');
    }
}

window.openProfile = () => $('profile-screen').classList.remove('hidden');
window.closeProfile = () => $('profile-screen').classList.add('hidden');

window.saveProfile = () => {
    myProfile.name = $('profile-name').value || 'Usuário';
    myProfile.bio = $('profile-bio').value;
    set(ref(db, 'users/' + myId), myProfile).then(() => {
        window.closeProfile();
    });
};

window.resetAccount = () => {
    if(confirm("Isso apagará seus contatos e histórico. Continuar?")) {
        localStorage.removeItem('zchat_id');
        location.reload();
    }
};

// --- 2. LISTA DE CONVERSAS (SISTEMA ANTI-BUG) ---
function renderList() {
    const list = $('chat-list');
    list.innerHTML = '';

    // Renderiza Contatos
    for (const cid in cacheContacts) {
        const c = cacheContacts[cid];
        const div = document.createElement('div');
        div.className = 'chat-item';
        div.innerHTML = `
            <div class="avatar-small">${c.name.charAt(0).toUpperCase()}</div>
            <div class="chat-info">
                <h4>${c.name}</h4>
                <p>Toque para conversar</p>
            </div>`;
        div.onclick = () => window.openChat(cid, 'dm', c.name);
        list.appendChild(div);
    }

    // Renderiza Grupos
    for (const gid in cacheGroups) {
        const g = cacheGroups[gid];
        if (g.members && g.members.includes(myId)) {
            const div = document.createElement('div');
            div.className = 'chat-item';
            div.innerHTML = `
                <div class="avatar-small">G</div>
                <div class="chat-info">
                    <h4>${g.name}</h4>
                    <p>Grupo</p>
                </div>`;
            div.onclick = () => window.openChat(gid, 'group', g.name);
            list.appendChild(div);
        }
    }
}

// Observadores em tempo real (sempre que o banco mudar, atualiza o cache e a tela)
onValue(ref(db, `contacts/${myId}`), snap => {
    cacheContacts = snap.val() || {};
    renderList();
});

onValue(ref(db, `groups`), snap => {
    cacheGroups = snap.val() || {};
    renderList();
});

// --- 3. CRIAR CONTATO E GRUPO ---
window.createContact = () => {
    const id = $('add-contact-token').value.trim();
    const name = $('add-contact-name').value.trim();
    if (!id || !name) return alert("Preencha todos os campos!");

    get(ref(db, 'users/' + id)).then(snap => {
        if (snap.exists()) {
            set(ref(db, `contacts/${myId}/${id}`), { name: name }).then(() => {
                window.closeModal('modal-add-contact');
                $('add-contact-token').value = '';
                $('add-contact-name').value = '';
            }).catch(err => alert("Erro ao salvar: " + err.message));
        } else {
            alert("ID não encontrado. Verifique o Token da pessoa.");
        }
    });
};

window.createGroup = () => {
    const name = $('new-group-name').value.trim();
    const membersStr = $('new-group-members').value.trim();
    if (!name) return alert("Digite o nome do grupo.");
    
    let members = [myId];
    if (membersStr) {
        const ids = membersStr.split(',').map(s => s.trim()).filter(s => s !== "");
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
        window.closeModal('modal-new-group');
        $('new-group-name').value = '';
        $('new-group-members').value = '';
    }).catch(err => alert("Erro ao criar grupo: " + err.message));
};

// --- 4. CHAT E MENSAGENS ---
window.openChat = (id, type, name) => {
    currentChatId = type === 'dm' ? [myId, id].sort().join('_') : id;
    currentChatType = type;
    
    $('empty-state').classList.add('hidden');
    $('chat-window').classList.remove('hidden');
    $('chat-name').innerText = name;
    
    if(window.innerWidth <= 768) {
        $('sidebar').classList.add('hidden-mobile');
        $('chat-area').classList.add('active');
    }

    loadMessages();
    listenTyping();
};

window.closeChat = () => {
    currentChatId = null;
    $('chat-window').classList.add('hidden');
    $('empty-state').classList.remove('hidden');
    $('sidebar').classList.remove('hidden-mobile');
    $('chat-area').classList.remove('active');
    clearTyping();
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
        if (msg.type === 'text') content = `<div>${msg.content}</div>`;
        else if (msg.type === 'image') content = `<img src="${msg.content}">`;
        else if (msg.type === 'audio') content = `<audio controls src="${msg.content}" style="max-width:100%; margin-top:8px;"></audio>`;

        div.innerHTML = `
            ${!isMe && currentChatType === 'group' ? `<div style="font-size:12px; color:var(--text-muted); margin-bottom:6px; font-weight:800; text-transform:uppercase;">${msg.senderName}</div>` : ''}
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
        sender: myId, senderName: myProfile.name, type: 'text', content: text,
        timestamp: Date.now(), deletedFor: []
    });
    input.value = '';
    $('btn-send').classList.add('hidden');
    $('btn-mic').classList.remove('hidden');
    clearTyping();
};

// --- 5. DIGITANDO E EMOJIS ---
window.handleTyping = () => {
    const input = $('message-input');
    if (!currentChatId) return;

    if (input.value.length > 0) {
        $('btn-send').classList.remove('hidden');
        $('btn-mic').classList.add('hidden');
    } else {
        $('btn-send').classList.add('hidden');
        $('btn-mic').classList.remove('hidden');
        clearTyping();
        return;
    }

    set(ref(db, `typing/${currentChatId}/${myId}`), true);
    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => clearTyping(), 2000);
};

function clearTyping() {
    if (currentChatId) remove(ref(db, `typing/${currentChatId}/${myId}`));
}

function listenTyping() {
    onValue(ref(db, `typing/${currentChatId}`), (snap) => {
        const typers = snap.val() || {};
        let isSomeoneTyping = false;
        for (const t in typers) { if (t !== myId) isSomeoneTyping = true; }

        if (isSomeoneTyping) {
            $('typing-status').classList.remove('hidden');
        } else {
            $('typing-status').classList.add('hidden');
        }
    });
}

window.toggleEmoji = () => {
    const panel = $('emoji-picker');
    panel.classList.toggle('hidden');
    if (panel.classList.contains('hidden')) return;
    
    const grid = $('emoji-grid');
    if (grid.innerHTML === '') {
        emojis.forEach(e => {
            const span = document.createElement('span');
            span.innerText = e;
            span.onclick = () => { $('message-input').value += e; window.handleTyping(); };
            grid.appendChild(span);
        });
    }
};

// --- 6. UPLOAD DE MÍDIA ---
window.handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file || !currentChatId) return;
    window.closeModal('modal-media');

    const reader = new FileReader();
    reader.onload = (ev) => {
        if (file.type === 'image/gif') {
            sendMedia(ev.target.result, 'image');
        } else {
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
        }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
};

function sendMedia(content, type) {
    push(ref(db, `messages/${currentChatId}`), {
        sender: myId, senderName: myProfile.name, type: type,
        content: content, timestamp: Date.now(), deletedFor: []
    });
}

window.toggleRecord = async () => {
    const btn = $('btn-mic');
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
    } catch (err) { alert("Erro ao acessar microfone."); }
};

// --- 7. UPLOAD DE AVATAR E CALLS ---
$('input-avatar').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
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
            myProfile.avatar = canvas.toDataURL('image/jpeg', 0.8);
            updateProfileUI();
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
});

window.startCall = async (type) => {
    if(!currentChatId) return;
    window.closeModal('modal-media');
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

    } catch (err) { alert("Erro na chamada: " + err.message); }
};

window.toggleMic = () => { const t = localStream.getAudioTracks()[0]; t.enabled = !t.enabled; $('btn-mute').style.opacity = t.enabled ? '1' : '0.5'; };
window.toggleVideo = () => { const t = localStream.getVideoTracks()[0]; if(t) { t.enabled = !t.enabled; $('btn-cam').style.opacity = t.enabled ? '1' : '0.5'; } };
window.endCall = () => {
    if (peerConnection) peerConnection.close();
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    $('call-overlay').classList.add('hidden');
    if(currentChatId) remove(ref(db, `calls/${currentChatId}`));
    peerConnection = null; localStream = null;
};

// --- 8. UTILS ---
window.openModal = (id) => $(id).classList.remove('hidden');
window.closeModal = (id) => $(id).classList.add('hidden');
window.filterList = () => {
    const term = $('search-input').value.toLowerCase();
    const items = document.querySelectorAll('.chat-item');
    items.forEach(item => {
        const name = item.querySelector('h4').innerText.toLowerCase();
        item.style.display = name.includes(term) ? 'flex' : 'none';
    });
};