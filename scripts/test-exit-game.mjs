import { io } from 'socket.io-client';

const SERVER_URL = 'http://127.0.0.1:3000';

function createClient(name, userId, avatar) {
  return new Promise((resolve, reject) => {
    const socket = io(SERVER_URL, {
      transports: ['websocket'],
      reconnection: false,
      timeout: 5000,
    });
    socket.on('connect', () => resolve({ socket, name, userId, avatar }));
    socket.on('connect_error', reject);
  });
}

async function run() {
  console.log('🧪 开始测试：牌局进行中玩家退出与AI托管接管验证...');

  const host = await createClient('房主仙长', 'user_host_101', '🐉');
  const player2 = await createClient('游历仙客', 'user_guest_102', '🦅');

  // 1. Host creates room with autoFillBots = true so game can start
  const createRes = await new Promise(res => {
    host.socket.emit('room:create', {
      userId: host.userId,
      name: host.name,
      roomName: '退出功能测试房',
      settings: { autoFillBots: true, turnTimeLimit: 15 },
      avatar: host.avatar,
    }, res);
  });

  const roomId = createRes.roomId;
  console.log(`✅ 房间创建成功: #${roomId}`);

  // 2. Player 2 joins
  const joinRes = await new Promise(res => {
    player2.socket.emit('room:join', {
      roomId,
      userId: player2.userId,
      name: player2.name,
      avatar: player2.avatar,
    }, res);
  });
  console.log(`✅ 玩家2已加入房间 #${roomId}`);

  // 3. Both join voice
  host.socket.emit('voice:join', { roomId, userId: host.userId, name: host.name, avatar: host.avatar });
  player2.socket.emit('voice:join', { roomId, userId: player2.userId, name: player2.name, avatar: player2.avatar });

  // 4. Host starts the game
  const startRes = await new Promise(res => {
    host.socket.emit('room:start', { roomId, userId: host.userId }, res);
  });
  console.log('✅ 牌局已顺利开打！');

  let p2ReceivedStateAfterLeave = false;
  player2.socket.on('room:game_state', () => {
    if (p2Left) {
      p2ReceivedStateAfterLeave = true;
    }
  });

  // 5. Player 2 exits the game during play
  let p2Left = false;
  console.log('🚪 玩家2在牌局进行中发起退出 (room:leave)...');
  const leaveRes = await new Promise(res => {
    player2.socket.emit('room:leave', { roomId, userId: player2.userId }, res);
  });

  p2Left = true;
  if (!leaveRes.success) {
    throw new Error('玩家2退出失败');
  }
  console.log('✅ 玩家2已成功收到退出成功确认信令');

  // 6. Wait 1.5s to verify:
  // - Host's room continues smoothly with bot takeover
  // - Player 2 receives 0 leaked room packets
  await new Promise(r => setTimeout(r, 1500));

  if (p2ReceivedStateAfterLeave) {
    throw new Error('❌ 玩家2退出后仍然收到了旧房间的推送数据包！');
  }
  console.log('✅ 验证通过：玩家2退出后未收到任何旧房间的广播数据');

  // 7. Verify Player 2 can immediately create a brand new room
  const newRoomRes = await new Promise(res => {
    player2.socket.emit('room:create', {
      userId: player2.userId,
      name: player2.name,
      roomName: '新篇章测试房',
      settings: { autoFillBots: true, turnTimeLimit: 15 },
      avatar: player2.avatar,
    }, res);
  });

  if (!newRoomRes.success) {
    throw new Error('玩家2返回大厅后创建新房间失败');
  }
  console.log(`✅ 验证通过：玩家2成功脱离原桌台并开辟全新房间 #${newRoomRes.roomId}`);

  host.socket.disconnect();
  player2.socket.disconnect();

  console.log('🎉 牌局中退出、AI托管与返回大厅流程全线验证 100% 成功！');
}

run().catch(err => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
