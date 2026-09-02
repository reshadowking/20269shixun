/**
 * E2E 全局准备：清空 y-websocket 持久化状态并重启容器。
 * room 状态在测试间累积会导致竞态（页面异步同步旧状态覆盖测试 reset），必须清空。
 * leveldb 文件被进程占用，需先停容器再挂载 volume 清理。
 */
import { execSync } from 'node:child_process'

export default function globalSetup() {
  const run = (cmd: string) => execSync(cmd, { stdio: 'pipe', timeout: 60_000 })
  try {
    run('docker stop design-y-websocket')
    // leveldb 持久化在 /data 根目录（非 /data/storage——旧路径从未生效，导致 room 残留）
    run('docker run --rm -v docker_yjsdata:/data node:22-alpine sh -c "rm -rf /data/*"')
    run('docker start design-y-websocket')
    console.log('[globalSetup] y-websocket 状态已清空并重启')
  } catch (err) {
    console.warn('[globalSetup] 无法重置 y-websocket：', (err as Error).message.split('\n')[0])
  }
}
