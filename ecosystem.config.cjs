module.exports = {
  apps: [
    {
      name: 'wuxing-mahjong',
      script: 'dist/server.cjs',
      instances: 1, // 游戏房间数据常驻内存，推荐单实例守护运行
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};
