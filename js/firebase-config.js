/* ============================================================
 * Firebase 云端配置（GitHub Pages 云端版）
 * 填入 Firebase 项目的 Realtime Database 地址后，
 * 网站即自动切换为【云端模式】：数据存云端，任何成员电脑
 * 开关机都不影响使用，网址固定为 GitHub Pages 地址。
 * 留空 = 使用本机服务器/单机模式。
 * ============================================================ */
window.__OKR_FIREBASE__ = window.__OKR_FIREBASE__ || {};
if (!window.__OKR_FIREBASE__.databaseURL) {
  window.__OKR_FIREBASE__.databaseURL = 'https://okr-club-default-rtdb.asia-southeast1.firebasedatabase.app';
}
