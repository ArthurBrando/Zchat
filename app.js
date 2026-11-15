import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, push, set, get, onValue, onChildAdded, remove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// CONFIGURAÇÃO DO FIREBASE (Substitua pelas suas chaves se necessário)
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

// Variáveis de Estado
let myId = localStorage.getItem('zchat_id');
let myProfile = { name: 'Usuário', bio: '' };
let currentChatId = null;
let currentChatType = null; // 'dm' ou 'group'
let mediaRecorder = null;
let audioChunks = [];
let localStream = null;
let peerConnection = null;

// Elementos DOM
const $ = id => document.getElementById(id);

// 1. INICIALIZAÇÃO E TOKEN
if (!myId) {
    myId = 'zc_' + Math.random().toString(36).substring(2, 6);
    localStorage.setItem('zchat_id', myId);
}

$('my-token').innerText = myId;
$('modal-token').innerText = myId;
$('empty-token').innerText = myId;

// Carrega perfil do usuário no DB
get(ref(db, 'users/' + myId)).then(snap => {
    if (snap.exists()) {
        myProfile = snap.val();
        $('my-name').innerText = myProfile.name;
        $('set-name').value = myProfile.name;
        $('set-bio').value = myProfile.bio || '';
    } else {
        set(ref(db, 'users/' + myId), { name: 'Usuário ' + myId, bio: '' });
    }
});

function saveProfile() {
    const name = $('set-name').value;
    const bio = $('set-bio').value;
    set(ref(db, 'users/' + myId), { name, bio });
    myProfile.name = name;
    $('my-name').innerText = name;
    $('settings-modal').classList.add('hidden');
}

function resetToken() {
    if(confirm("Isso apagará seus contatos e histórico. Continuar?")) {
        localStorage.removeItem('zchat_id');
        location.reload();
    }
}

// 2. CONTATOS E GRUPOS (SIDEBAR)
function renderSidebar() {
    const list = $('chat-list');
    list.innerHTML = '';

    // Carrega Contatos (DMs)
    onValue(ref(db, `contacts/${myId}`), snap => {
        list.innerHTML = '';
        if (snap.exists()) {
            const contacts = snap.val();
            for (const cid in contacts) {
                const c = contacts[cid];
                const div = document.createElement('div');
                div.className = 'chat-item';
                div.innerHTML = `<div class="avatar">${c.name.charAt(0)}</div><div class="chat-item-info"><h4>${c.name}</h4><p>Toque para conversar</p></div>`;
                div.onclick = () => openChat(cid, 'dm', c.name);
                list.appendChild(div);
            }
        }
        
        // Carrega Grupos
        get(ref(db, `groups`)).then(gSnap => {
            if (gSnap.exists()) {
                const groups = gSnap.val();
                for (const gid in groups) {
                    const g = groups[gid];
                    if (g.members && g.members.includes(myId)) {
                        const div = document.createElement('div');
                        div.className = 'chat-item';
                        div.innerHTML = `<div class="avatar">G</div><div class="chat-item-info"><h4>${g.name}</h4><p>Grupo</p></div>`;
                        div.onclick = () => openChat(gid, 'group', g.name);
                        list.appendChild(div);
                    }
                }
            }
        });
    });
}
renderSidebar();

function addContact() {
    const id = $('contact-id-input').value.trim();
    const name = $('contact-name-input').value.trim();
    if (!id || !name) return alert("Preencha tudo!");

    get(ref(db, 'users/' + id)).then(snap => {
        if (snap.exists()) {
            set(ref(db, `contacts/${myId}/${id}`), { name: name });
            $('add-contact-modal').classList.add('hidden');
            $('contact-id-input').value = '';
            $('contact-name-input').value = '';
        } else {
            alert("ID não encontrado no Zchat.");
        }
    });
}

function createGroup() {
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
        alert("Grupo criado!");
        $('group-modal').classList.add('hidden');
        $('group-name-input').value = '';
        $('group-members-input').value = '';
        renderSidebar();
    });
}

// 3. CHAT E MENSAGENS
function openChat(id, type, name) {
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
}

function closeChat() {
    currentChatId = null;
    $('chat-window').classList.add('hidden');
    $('empty-state').classList.remove('hidden');
    $('sidebar').classList.remove('hidden-mobile');
    $('main-chat').classList.remove('active');
}

function loadMessages() {
    const container = $('messages-container');
    container.innerHTML = '';
    
    onChildAdded(ref(db, `messages/${currentChatId}`), (snapshot) => {
        const msg = snapshot.val();
        if (msg.deletedFor && msg.deletedFor.includes(myId)) return; // Lógica de apagar

        const isMe = msg.sender === myId;
        const div = document.createElement('div');
        div.className = `msg ${isMe ? 'sent' : 'received'}`;
        
        let content = '';
        if (msg.type === 'text') content = `<div class="msg-text">${msg.content}</div>`;
        else if (msg.type === 'image') content = `<img src="${msg.content}">`;
        else if (msg.type === 'audio') content = `<audio controls src="${msg.content}"></audio>`;

        div.innerHTML = `
            ${!isMe && currentChatType === 'group' ? `<div style="font-size:11px; color:#888; margin-bottom:2px;">${msg.senderName}</div>` : ''}
            ${content}
            <span class="msg-time">${new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
        `;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    });
}

function sendMessage() {
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
}

// 4. UPLOAD DE IMAGEM E ÁUDIO
function handleImage(e) {
    const file = e.target.files[0];
    if (!file || !currentChatId) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
            const canvas = $('resize-canvas');
            const ctx = canvas.getContext('2d');
            let width = img.width, height = img.height;
            const MAX = 600; // Comprime para não pesar no Firebase
            if (width > height && width > MAX) { height *= MAX / width; width = MAX; }
            else if (height > MAX) { width *= MAX / height; height = MAX; }
            canvas.width = width; canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);
            
            push(ref(db, `messages/${currentChatId}`), {
                sender: myId, senderName: myProfile.name, type: 'image',
                content: canvas.toDataURL('image/jpeg', 0.6), timestamp: Date.now(), deletedFor: []
            });
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = ''; // Limpa o input
}

async function toggleRecord() {
    const btn = $('record-btn');
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        btn.style.color = 'var(--text-main)';
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
            reader.onload = (ev) => {
                push(ref(db, `messages/${currentChatId}`), {
                    sender: myId, senderName: myProfile.name, type: 'audio',
                    content: ev.target.result, timestamp: Date.now(), deletedFor: []
                });
            };
            reader.readAsDataURL(audioBlob);
        };

        mediaRecorder.start();
        btn.style.color = 'red';
    } catch (err) { alert("Erro ao acessar microfone."); }
}

// 5. WEBRTC (CHAMADAS DE ÁUDIO E VÍDEO)
async function startCall(type) {
    if(!currentChatId) return;
    const callId = currentChatId; // Usa o ID do chat para sinalizar
    
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
}

// Receber Chamada
onChildAdded(ref(db, 'calls'), (snapshot) => {
    const callId = snapshot.key;
    const data = snapshot.val();
    if (data.offer && data.offer.caller !== myId && !peerConnection) {
        // Aqui você pode adicionar um toque de chamada ou confirmação
        setTimeout(async () => {
            $('call-overlay').classList.remove('hidden');
            peerConnection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
            peerConnection.onicecandidate = (e) => { if (e.candidate) push(ref(db, `calls/${callId}/candidates`), e.candidate.toJSON()); };
            peerConnection.ontrack = (e) => { $('remote-video').srcObject = e.streams[0]; };
            
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            set(ref(db, `calls/${callId}/answer`), { answer, answerer: myId });
            
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));
            $('local-video').srcObject = localStream;
        }, 1000);
    }
});

function toggleMic() { const t = localStream.getAudioTracks()[0]; t.enabled = !t.enabled; $('btn-mic').style.opacity = t.enabled ? '1' : '0.5'; }
function toggleVideo() { const t = localStream.getVideoTracks()[0]; if(t) { t.enabled = !t.enabled; $('btn-cam').style.opacity = t.enabled ? '1' : '0.5'; } }
function endCall() {
    if (peerConnection) peerConnection.close();
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    $('call-overlay').classList.add('hidden');
    // Limpa a call do DB
    if(currentChatId) remove(ref(db, `calls/${currentChatId}`));
    peerConnection = null; localStream = null;
}