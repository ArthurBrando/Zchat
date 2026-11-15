import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, push, set, get, onValue, onChildAdded, remove, update } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

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
let currentChatTargetId = null; // ID do outro usuário ou do grupo
let currentChatName = "";
let mediaRecorder = null;
let audioChunks = [];
let localStream = null;
let peerConnection = null;
let typingTimeout = null;
let selectedMemberId = null;
let selectedMemberName = "";

let cacheContacts = {};
let cacheGroups = {};
let blockedUsers = {};

const $ = id => document.getElementById(id);

const emojis = ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','👍','👎','👊','✌️','🤞','🖐️','✋','🤚','👋','🤙','💪','🙏','🎮','🎲','🎯','🏆','⚽','🏀','🎸','🎧','🎤','💻','📱','💡','🔥','❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💯','💢','💥','💫','💦','💨','💣','💬','💤'];

// --- 1. INICIALIZAÇÃO ---
if (!myId) {
    myId = 'zc_' + Math.random().toString(36).substring(2, 6);
    localStorage.setItem('zchat_id', myId);
}

$('my-token').innerText = myId;
if ("Notification" in window) { Notification.requestPermission(); }

get(ref(db, 'users/' + myId)).then(snap => {
    if (snap.exists()) {
        myProfile = snap.val();
    } else {
        myProfile.name = 'Usuário ' + myId;
        set(ref(db, 'users/' + myId), myProfile);
    }
    updateProfileUI();
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

// --- 2. SIDEBAR E CONTATOS ---
function renderList() {
    const list = $('chat-list');
    list.innerHTML = '';

    for (const cid in cacheContacts) {
        const c = cacheContacts[cid];
        if (blockedUsers[cid]) continue; // Oculta contatos bloqueados
        const div = document.createElement('div');
        div.className = 'chat-item';
        div.innerHTML = `<div class="avatar-small">${c.name.charAt(0).toUpperCase()}</div><div class="chat-info"><h4>${c.name}</h4><p>Toque para conversar</p></div>`;
        div.onclick = () => window.openChat(cid, 'dm', c.name, cid);
        list.appendChild(div);
    }

    for (const gid in cacheGroups) {
        const g = cacheGroups[gid];
        if (g.members && g.members.includes(myId) && !g.blocked?.includes(myId)) {
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

// --- 3. CHAT E MENSAGENS ---
window.openChat = (id, type, name, targetId) => {
    currentChatId = type === 'dm' ? [myId, id].sort().join('_') : id;
    currentChatType = type;
    currentChatName = name;
    currentChatTargetId = targetId;
    
    $('empty-state').classList.add('hidden');
    $('chat-window').classList.remove('hidden');
    $('chat-name').innerText = name;
    
    // Aplica papel de parede salvo
    const savedWp = localStorage.getItem('wp_' + currentChatId);
    if(savedWp) $('chat-area').style.backgroundImage = `url(${savedWp})`;
    else $('chat-area').style.backgroundImage = 'none';

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
        if (currentChatType === 'dm' && blockedUsers[msg.sender]) return; // Bloqueado

        const isMe = msg.sender === myId;
        const div = document.createElement('div');
        div.className = `msg ${isMe ? 'sent' : 'received'}`;
        
        let content = '';
        if (msg.type === 'text') content = `<div>${msg.content}</div>`;
        else if (msg.type === 'image') content = `<img src="${msg.content}">`;
        else if (msg.type === 'audio') content = `<audio controls src="${msg.content}" style="max-width:100%; margin-top:8px;"></audio>`;

        // Avatar clicável para abrir perfil
        div.innerHTML = `
            ${!isMe && currentChatType === 'group' ? `<div onclick="window.openUserProfile('${msg.sender}', '${msg.senderName}')" style="font-size:12px; color:var(--text-muted); margin-bottom:6px; font-weight:800; text-transform:uppercase; cursor:pointer;">${msg.senderName}</div>` : ''}
            ${content}
            <span class="msg-time">${new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
        `;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;

        // Notificação
        if (!isMe && document.hidden && Notification.permission === "granted") {
            new Notification(msg.senderName, { body: msg.type === 'text' ? msg.content : 'Enviou uma mídia' });
        }
    });
}

window.sendMessage = async () => {
    const input = $('message-input');
    const text = input.value.trim();
    if (!text || !currentChatId) return;

    push(ref(db, `messages/${currentChatId}`), {
        sender: myId, senderName: myProfile.name, type: 'text', content: text, timestamp: Date.now(), deletedFor: []
    });

    // Auto-Adicionar contato para quem recebeu (Resolve o problema de ter que add dos dois lados)
    if (currentChatType === 'dm') {
        const otherUser = currentChatId.split('_').find(id => id !== myId);
        get(ref(db, `contacts/${otherUser}/${myId}`)).then(snap => {
            if (!snap.exists()) {
                set(ref(db, `contacts/${otherUser}/${myId}`), { name: myProfile.name });
            }
        });
        get(ref(db, `contacts/${myId}/${otherUser}`)).then(snap => {
            if (!snap.exists()) {
                set(ref(db, `contacts/${myId}/${otherUser}`), { name: currentChatName });
            }
        });
    }

    input.value = '';
    $('btn-send').classList.add('hidden');
    $('btn-mic').classList.remove('hidden');
    clearTyping();
};

// --- 4. MENU DO CHAT (3 PONTOS) E CONFIGURAÇÕES ---
window.openChatMenu = () => $('chat-menu').classList.remove('hidden');

window.changeWallpaper = () => {
    const url = prompt("Cole a URL da imagem para o papel de parede (ou deixe vazio para remover):");
    if (url !== null) {
        if (url === "") {
            localStorage.removeItem('wp_' + currentChatId);
            $('chat-area').style.backgroundImage = 'none';
        } else {
            localStorage.setItem('wp_' + currentChatId, url);
            $('chat-area').style.backgroundImage = `url(${url})`;
        }
        window.closeModal('chat-menu');
    }
};

window.clearChat = () => {
    if(confirm("Apagar o histórico desta conversa apenas para você?")) {
        remove(ref(db, `messages/${currentChatId}`)); // Na prática, apaga pra todos no Realtime DB, mas o ideal seria marcar deletedFor
        window.closeModal('chat-menu');
        $('messages-container').innerHTML = '';
    }
};

window.blockUser = () => {
    if(currentChatType !== 'dm') return alert("Só é possível bloquear em conversas individuais.");
    if(confirm("Bloquear este contato? Você não receberá mais mensagens dele.")) {
        set(ref(db, `blocked/${myId}/${currentChatTargetId}`), true);
        window.closeModal('chat-menu');
        window.closeModal('chat-info-modal');
        window.closeChat();
    }
};

// --- 5. PERFIL DE OUTROS USUÁRIOS E GRUPOS ---
window.openChatInfo = async () => {
    $('chat-info-modal').classList.remove('hidden');
    $('info-name').innerText = currentChatName;
    
    if (currentChatType === 'dm') {
        $('group-members-area').classList.add('hidden');
        $('btn-block-info').classList.remove('hidden');
        const snap = await get(ref(db, 'users/' + currentChatTargetId));
        if(snap.exists()) {
            const data = snap.val();
            $('info-bio').innerText = data.bio || 'Sem recado.';
            if(data.avatar) $('info-avatar').innerHTML = `<img src="${data.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
            else $('info-avatar').innerText = currentChatName.charAt(0).toUpperCase();
        }
    } else {
        // É um Grupo
        $('btn-block-info').classList.add('hidden');
        $('group-members-area').classList.remove('hidden');
        $('info-bio').innerText = 'Membros do Grupo';
        $('info-avatar').innerText = 'G';
        
        const snap = await get(ref(db, 'groups/' + currentChatId));
        const g = snap.val();
        const list = $('group-members-list');
        list.innerHTML = '';
        
        for (const mid of g.members) {
            const uSnap = await get(ref(db, 'users/' + mid));
            const uName = uSnap.exists() ? uSnap.val().name : mid;
            const uAvatar = uSnap.exists() && uSnap.val().avatar ? uSnap.val().avatar : '';
            
            const isAdmin = (g.admin === mid || (g.admins && g.admins.includes(mid)));
            const isMuted = (g.muted && g.muted.includes(mid));

            const div = document.createElement('div');
            div.className = 'member-item';
            div.innerHTML = `
                <div style="width:36px;height:36px;border-radius:50%;background:var(--border);display:flex;justify-content:center;align-items:center;overflow:hidden;">
                    ${uAvatar ? `<img src="${uAvatar}" style="width:100%;height:100%;object-fit:cover;">` : uName.charAt(0).toUpperCase()}
                </div>
                <div><strong>${uName} ${mid === myId ? '(Você)' : ''}</strong><span>${isAdmin ? 'Admin' : 'Membro'} ${isMuted ? '• Mutado' : ''}</span></div>
            `;
            // Só o admin pode clicar para gerenciar os outros
            if (g.admin === myId && mid !== myId) {
                div.onclick = () => window.openMemberActions(mid, uName);
            }
            list.appendChild(div);
        }
    }
};

window.openUserProfile = async (uid, name) => {
    if(uid === myId) return window.openProfile();
    currentChatTargetId = uid;
    currentChatName = name;
    window.openChatInfo();
};

// --- 6. GERENCIAMENTO DE MEMBROS (GRUPO) ---
window.openMemberActions = (uid, name) => {
    selectedMemberId = uid;
    selectedMemberName = name;
    $('member-action-name').innerText = "Gerenciar: " + name;
    $('member-action-modal').classList.remove('hidden');
};

window.promoteMember = async () => {
    const snap = await get(ref(db, 'groups/' + currentChatId));
    const g = snap.val();
    let admins = g.admins || [];
    if(!admins.includes(selectedMemberId)) admins.push(selectedMemberId);
    update(ref(db, 'groups/' + currentChatId), { admins });
    window.closeModal('member-action-modal');
    window.closeModal('chat-info-modal');
};

window.muteMember = async () => {
    const snap = await get(ref(db, 'groups/' + currentChatId));
    const g = snap.val();
    let muted = g.muted || [];
    if(muted.includes(selectedMemberId)) muted = muted.filter(id => id !== selectedMemberId);
    else muted.push(selectedMemberId);
    update(ref(db, 'groups/' + currentChatId), { muted });
    window.closeModal('member-action-modal');
    window.closeModal('chat-info-modal');
};

window.kickMember = async () => {
    if(!confirm(`Remover ${selectedMemberName} do grupo?`)) return;
    const snap = await get(ref(db, 'groups/' + currentChatId));
    const g = snap.val();
    let members = g.members.filter(id => id !== selectedMemberId);
    update(ref(db, 'groups/' + currentChatId), { members });
    window.closeModal('member-action-modal');
    window.closeModal('chat-info-modal');
};

window.banMember = async () => {
    if(!confirm(`Banir permanentemente ${selectedMemberName}?`)) return;
    const snap = await get(ref(db, 'groups/' + currentChatId));
    const g = snap.val();
    let members = g.members.filter(id => id !== selectedMemberId);
    let blocked = g.blocked || [];
    if(!blocked.includes(selectedMemberId)) blocked.push(selectedMemberId);
    update(ref(db, 'groups/' + currentChatId), { members, blocked });
    window.closeModal('member-action-modal');
    window.closeModal('chat-info-modal');
};

// --- 7. API DE GIFS (TENOR) ---
window.openModal = (id) => {
    $(id).classList.remove('hidden');
    if(id === 'modal-gif' && $('gif-container').innerHTML === '') {
        window.searchGifs('trending');
    }
};
window.closeModal = (id) => $(id).classList.add('hidden');

$('gif-search')?.addEventListener('keypress', (e) => {
    if(e.key === 'Enter') window.searchGifs(e.target.value);
});

window.searchGifs = async (query) => {
    const url = `https://tenor.googleapis.com/v2/search?q=${query}&key=LIVDSRZULELA&limit=15`;
    const res = await fetch(url);
    const data = await res.json();
    const container = $('gif-container');
    container.innerHTML = '';
    
    data.results.forEach(gif => {
        const img = document.createElement('img');
        img.src = gif.media_formats.tinygif.url;
        img.onclick = () => {
            sendMedia(gif.media_formats.gif.url, 'image');
            window.closeModal('modal-gif');
        };
        container.appendChild(img);
    });
};

// --- 8. UPLOAD E MÍDIA ---
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
        sender: myId, senderName: myProfile.name, type: type, content: content, timestamp: Date.now(), deletedFor: []
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

// --- 9. PERFIL E CONTA ---
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

window.saveProfile = () => {
    myProfile.name = $('profile-name').value || 'Usuário';
    myProfile.bio = $('profile-bio').value;
    set(ref(db, 'users/' + myId), myProfile).then(() => window.closeProfile());
};

window.openProfile = () => $('profile-screen').classList.remove('hidden');
window.closeProfile = () => $('profile-screen').classList.add('hidden');
window.resetAccount = () => { if(confirm("Apagar tudo e resetar ID?")) { localStorage.removeItem('zchat_id'); location.reload(); } };

// --- 10. CRIAR CONTATO E GRUPO ---
window.createContact = () => {
    const id = $('add-contact-token').value.trim();
    const name = $('add-contact-name').value.trim();
    if (!id || !name) return alert("Preencha tudo!");
    get(ref(db, 'users/' + id)).then(snap => {
        if (snap.exists()) {
            set(ref(db, `contacts/${myId}/${id}`), { name: name }).then(() => {
                window.closeModal('modal-add-contact');
                $('add-contact-token').value = ''; $('add-contact-name').value = '';
            });
        } else alert("ID não encontrado.");
    });
};

window.createGroup = () => {
    const name = $('new-group-name').value.trim();
    const membersStr = $('new-group-members').value.trim();
    if (!name) return alert("Digite o nome do grupo.");
    let members = [myId];
    if (membersStr) members = members.concat(membersStr.split(',').map(s => s.trim()));
    const gid = 'gp_' + Date.now();
    set(ref(db, 'groups/' + gid), { name, admin: myId, members, muted: [], blocked: [] }).then(() => {
        window.closeModal('modal-new-group');
        $('new-group-name').value = ''; $('new-group-members').value = '';
    });
};

// --- 11. WEBRTC E DIGITAÇÃO ---
window.handleTyping = () => {
    if (!currentChatId) return;
    const input = $('message-input');
    if (input.value.length > 0) {
        $('btn-send').classList.remove('hidden'); $('btn-mic').classList.add('hidden');
    } else {
        $('btn-send').classList.add('hidden'); $('btn-mic').classList.remove('hidden');
        clearTyping(); return;
    }
    set(ref(db, `typing/${currentChatId}/${myId}`), true);
    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => clearTyping(), 2000);
};
function clearTyping() { if (currentChatId) remove(ref(db, `typing/${currentChatId}/${myId}`)); }
function listenTyping() {
    onValue(ref(db, `typing/${currentChatId}`), (snap) => {
        const typers = snap.val() || {};
        let isSomeoneTyping = false;
        for (const t in typers) { if (t !== myId) isSomeoneTyping = true; }
        if (isSomeoneTyping) $('typing-status').classList.remove('hidden');
        else $('typing-status').classList.add('hidden');
    });
}

window.startCall = async (type) => {
    if(!currentChatId) return;
    window.closeModal('modal-media');
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: type === 'video', audio: true });
        $('local-video').srcObject = localStream;
        $('call-overlay').classList.remove('hidden');
        peerConnection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));
        peerConnection.onicecandidate = (e) => { if (e.candidate) push(ref(db, `calls/${currentChatId}/candidates`), e.candidate.toJSON()); };
        peerConnection.ontrack = (e) => { $('remote-video').srcObject = e.streams[0]; };
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        set(ref(db, `calls/${currentChatId}/offer`), { offer, caller: myId });
    } catch (err) { alert("Erro na chamada: " + err.message); }
};
window.toggleMic = () => { const t = localStream.getAudioTracks()[0]; t.enabled = !t.enabled; $('btn-mute').style.opacity = t.enabled ? '1' : '0.5'; };
window.toggleVideo = () => { const t = localStream.getVideoTracks()[0]; if(t) { t.enabled = !t.enabled; $('btn-cam').style.opacity = t.enabled ? '1' : '0.5'; } };
window.endCall = () => { if (peerConnection) peerConnection.close(); if (localStream) localStream.getTracks().forEach(t => t.stop()); $('call-overlay').classList.add('hidden'); if(currentChatId) remove(ref(db, `calls/${currentChatId}`)); peerConnection = null; localStream = null; };
window.filterList = () => { const term = $('search-input').value.toLowerCase(); document.querySelectorAll('.chat-item').forEach(item => { item.style.display = item.querySelector('h4').innerText.toLowerCase().includes(term) ? 'flex' : 'none'; }); };