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

const $ = id => document.getElementById(id);

// Emojis
const emojiList = ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','👍','👎','👊','✌️','🤞','🖐️','✋','🤚','👋','🤙','💪','🙏','🎮','🎲','🎯','🏆','⚽','🏀','🎸','🎧','🎤','💻','📱','💡','🔥','❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💯','💢','💥','💫','💦','💨','💣','💬','💤'];

// 1. INICIALIZAÇÃO
if (!myId) {
    myId = 'zc_' + Math.random().toString(36).substring(2, 6);
    localStorage.setItem('zchat_id', myId);
}

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
    $('set-name').value = myProfile.name;
    $('set-bio').value = myProfile.bio || '';
    
    if (myProfile.avatar) {
        $('profile-img').src = myProfile.avatar;
        $('profile-img').style.display = 'block';
        $('profile-letter').style.display = 'none';
    } else {
        $('profile-letter').innerText = myProfile.name.charAt(0).toUpperCase();
        $('profile-img').style.display = 'none';
        $('profile-letter').style.display = 'block';
    }
}

// 2. RENDERIZAÇÃO DA LISTA (CORRIGIDO PARA NÃO SUMIR)
function loadSidebarData() {
    const list = $('chat-list');
    
    // Busca Contatos e Grupos ao mesmo tempo
    Promise.all([
        get(ref(db, `contacts/${myId}`)),
        get(ref(db, `groups`))
    ]).then(([contactsSnap, groupsSnap]) => {
        list.innerHTML = '';
        
        const contacts = contactsSnap.val() || {};
        for (const cid in contacts) {
            const c = contacts[cid];
            const div = document.createElement('div');
            div.className = 'chat-item';
            div.innerHTML = `
                <div class="avatar-small">${c.name.charAt(0).toUpperCase()}</div>
                <div class="chat-item-info">
                    <h4>${c.name}</h4>
                    <p>Toque para conversar</p>
                </div>`;
            div.onclick = () => window.openChat(cid, 'dm', c.name);
            list.appendChild(div);
        }
        
        const groups = groupsSnap.val() || {};
        for (const gid in groups) {
            const g = groups[gid];
            if (g.members && g.members.includes(myId)) {
                const div = document.createElement('div');
                div.className = 'chat-item';
                div.innerHTML = `
                    <div class="avatar-small">G</div>
                    <div class="chat-item-info">
                        <h4>${g.name}</h4>
                        <p>Grupo</p>
                    </div>`;
                div.onclick = () => window.openChat(gid, 'group', g.name);
                list.appendChild(div);
            }
        }
    });
}

// Escuta mudanças em tempo real para atualizar a lista
onValue(ref(db, `contacts/${myId}`), () => loadSidebarData());
onValue(ref(db, `groups`), () => loadSidebarData());
loadSidebarData(); // Chama a primeira vez

// 3. CHAT E MENSAGENS
window.openChat = (id, type, name) => {
    currentChatId = type === 'dm' ? [myId, id].sort().join('_') : id;
    currentChatType = type;
    
    $('empty-state').classList.add('hidden');
    $('chat-window').classList.remove('hidden');
    $('chat-title').innerText = name;
    $('chat-avatar').innerText = name.charAt(0).toUpperCase();
    
    if(window.innerWidth <= 768) {
        $('sidebar').classList.add('hidden-mobile');
        $('main-chat').classList.add('active');
    }

    loadMessages();
    listenTyping();
};

window.closeChat = () => {
    currentChatId = null;
    $('chat-window').classList.add('hidden');
    $('empty-state').classList.remove('hidden');
    $('sidebar').classList.remove('hidden-mobile');
    $('main-chat').classList.remove('active');
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
        if (msg.type === 'text') content = `<div class="msg-text">${msg.content}</div>`;
        else if (msg.type === 'image') content = `<img src="${msg.content}">`;
        else if (msg.type === 'audio') content = `<audio controls src="${msg.content}" style="max-width:100%; margin-top:5px;"></audio>`;

        div.innerHTML = `
            ${!isMe && currentChatType === 'group' ? `<div style="font-size:12px; color:var(--accent); margin-bottom:4px; font-weight:bold;">${msg.senderName}</div>` : ''}
            ${content}
            <span class="msg-time">${new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} ${isMe ? '✓✓' : ''}</span>
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

// 4. DIGITANDO...
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
    typingTimeout = setTimeout(() => clearTyping(), 2000);
};

function clearTyping() {
    if (currentChatId) remove(ref(db, `typing/${currentChatId}/${myId}`));
}

function listenTyping() {
    onValue(ref(db, `typing/${currentChatId}`), (snap) => {
        const typers = snap.val() || {};
        let isSomeoneTyping = false;
        for (const t in typers) {
            if (t !== myId) isSomeoneTyping = true;
        }

        if (isSomeoneTyping) {
            $('typing-indicator').classList.remove('hidden');
            $('typing-indicator').innerText = 'digitando...';
        } else {
            $('typing-indicator').classList.add('hidden');
        }
    });
}

// 5. PERFIL (UPLOAD E SALVAR)
$('set-avatar-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (ev) => {
        if (file.type === 'image/gif') {
            myProfile.avatar = ev.target.result;
            updateProfileUI();
        } else {
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
        }
    };
    reader.readAsDataURL(file);
});

window.saveProfile = () => {
    myProfile.name = $('set-name').value || 'Usuário';
    myProfile.bio = $('set-bio').value;
    
    set(ref(db, 'users/' + myId), myProfile).then(() => {
        window.closeProfile();
    });
};

window.openProfile = () => $('profile-page').classList.remove('hidden');
window.closeProfile = () => $('profile-page').classList.add('hidden');

// 6. ADICIONAR CONTATO E GRUPO
window.addContact = () => {
    const id = $('contact-id-input').value.trim();
    const name = $('contact-name-input').value.trim();
    if (!id || !name) return alert("Preencha todos os campos!");

    get(ref(db, 'users/' + id)).then(snap => {
        if (snap.exists()) {
            set(ref(db, `contacts/${myId}/${id}`), { name: name }).then(() => {
                window.closeModal('add-contact-modal');
                $('contact-id-input').value = '';
                $('contact-name-input').value = '';
                alert("Contato adicionado!");
            });
        } else {
            alert("ID não encontrado. Verifique o Token da pessoa.");
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
        alert("Grupo criado com sucesso!");
    });
};

// 7. MÍDIA E ÁUDIO
window.handleImage = (e) => {
    const file = e.target.files[0];
    if (!file || !currentChatId) return;
    window.closeModal('media-modal');

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
    } catch (err) { alert("Erro ao acessar microfone."); }
};

// 8. EMOJIS
window.toggleEmoji = () => {
    const panel = $('emoji-panel');
    panel.classList.toggle('hidden');
    if (panel.classList.contains('hidden')) return;
    
    const grid = $('emoji-grid');
    if (grid.innerHTML === '') {
        emojiList.forEach(e => {
            const span = document.createElement('span');
            span.innerText = e;
            span.onclick = () => { $('message-input').value += e; window.handleTyping(); };
            grid.appendChild(span);
        });
    }
};

// 9. WEBRTC BÁSICO
window.startCall = async (type) => {
    if(!currentChatId) return;
    window.closeModal('media-modal');
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

window.toggleMic = () => { const t = localStream.getAudioTracks()[0]; t.enabled = !t.enabled; $('btn-mic').style.opacity = t.enabled ? '1' : '0.5'; };
window.toggleVideo = () => { const t = localStream.getVideoTracks()[0]; if(t) { t.enabled = !t.enabled; $('btn-cam').style.opacity = t.enabled ? '1' : '0.5'; } };
window.endCall = () => {
    if (peerConnection) peerConnection.close();
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    $('call-overlay').classList.add('hidden');
    if(currentChatId) remove(ref(db, `calls/${currentChatId}`));
    peerConnection = null; localStream = null;
};

// Utilitários
window.openModal = (id) => $(id).classList.remove('hidden');
window.closeModal = (id) => $(id).classList.add('hidden');
window.filterChats = () => {
    const term = $('search-chat').value.toLowerCase();
    const items = document.querySelectorAll('.chat-item');
    items.forEach(item => {
        const name = item.querySelector('h4').innerText.toLowerCase();
        item.style.display = name.includes(term) ? 'flex' : 'none';
    });
};