/**
 * T46a-3b：冒烟脚本的**帧格式自检**（纯离线，不需要网关/后端/y-websocket）。
 *
 * 为什么必须有这一步：上一版 smoke.mjs 恰恰死在"手写载荷不合协议"——
 * `[0,2,9,9,9]` 不是合法 Yjs update，上游解码直接抛错、消息根本不广播，
 * 于是"网关漏写"永远测不出来（全绿假象）。下面把 `yjs-frames.mjs` 的编码
 * 与 y-protocols / lib0 的**官方实现**逐字节比对，确认真发出去的是合法帧。
 *
 * 跑法：cd docker/collab-gateway && npm i && node smoke.frames.test.mjs
 */
import assert from 'node:assert/strict'

import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'

import { frameSync, gotUpdateWith, realUpdate, updatePayload } from './yjs-frames.mjs'

const MESSAGE_SYNC = 0

/**
 * 官方编码：外层消息类型（y-websocket 由传输层写）+ sync 子消息。
 * 见 y-websocket/src/y-websocket.js:410 —— `writeVarUint(messageSync); syncProtocol.writeUpdate(...)`。
 */
function official(build) {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_SYNC)
  build(encoder)
  return encoding.toUint8Array(encoder)
}

/** 与 y-websocket 服务端一样：先读外层消息类型，再把剩下的交给 readSyncMessage。*/
function readAsUpstream(msg, doc) {
  const decoder = decoding.createDecoder(msg)
  decoding.readVarUint(decoder)
  return syncProtocol.readSyncMessage(decoder, encoding.createEncoder(), doc)
}

let passed = 0
function ok(name, fn) {
  try {
    fn()
    passed++
    console.log(`PASS  ${name}`)
  } catch (err) {
    process.exitCode = 1
    console.log(`FAIL  ${name}\n      ${err.message}`)
  }
}

const bytes = (u8) => [...u8]

ok('空 update 的帧与官方 writeUpdate 逐字节一致', () => {
  const update = Y.encodeStateAsUpdate(new Y.Doc())
  assert.deepEqual(bytes(frameSync(2, update)), bytes(official((enc) => syncProtocol.writeUpdate(enc, update))))
})

ok('带文本的 update 帧与官方一致', () => {
  const doc = new Y.Doc()
  doc.getText('t').insert(0, 'hello-marker')
  const update = Y.encodeStateAsUpdate(doc)
  assert.deepEqual(bytes(frameSync(2, update)), bytes(official((enc) => syncProtocol.writeUpdate(enc, update))))
})

ok('step1 帧与官方 writeSyncStep1 一致', () => {
  const doc = new Y.Doc()
  assert.deepEqual(
    bytes(frameSync(0, Y.encodeStateVector(doc))),
    bytes(official((enc) => syncProtocol.writeSyncStep1(enc, doc))),
  )
})

ok('realUpdate 造的帧能被上游 readSyncMessage 真正应用', () => {
  const upstream = new Y.Doc()
  readAsUpstream(realUpdate('hello-marker'), upstream)
  assert.equal(upstream.getText('t').toString(), 'hello-marker')
})

ok('网关的写判定（同 server.js）把 update 判为写、把 step1 判为非写', () => {
  const isWriteMessage = (buf) => (buf.length >= 2 && buf[0] === 0 ? buf[1] !== 0 : false)
  assert.equal(isWriteMessage(realUpdate('x')), true)
  assert.equal(isWriteMessage(frameSync(0, Y.encodeStateVector(new Y.Doc()))), false)
})

ok('旧脚本的假 payload 上游无法接受（这就是它失效的原因）', () => {
  let threw = false
  const upstream = new Y.Doc()
  try {
    readAsUpstream(Buffer.from([0, 2, 9, 9, 9]), upstream)
  } catch {
    threw = true
  }
  assert.ok(threw || upstream.getText('t').toString() === '', '假 payload 竟然被上游当成了有效内容')
})

ok('updatePayload 能还原 payload，且拒绝非 update 帧', () => {
  const update = Y.encodeStateAsUpdate(new Y.Doc())
  assert.deepEqual(bytes(updatePayload(frameSync(2, update))), bytes(update))
  assert.equal(updatePayload(frameSync(0, Y.encodeStateVector(new Y.Doc()))), null)
  assert.equal(updatePayload(Buffer.from([1, 2, 3, 4])), null)
})

ok('gotUpdateWith 命中自己的标记、不误认别人的 update', () => {
  const msgs = [frameSync(0, Y.encodeStateVector(new Y.Doc())), realUpdate('marker-a')]
  assert.equal(gotUpdateWith(msgs, 'marker-a'), true)
  assert.equal(gotUpdateWith(msgs, 'marker-b'), false)
})

console.log(`\n${passed}/8 项自检通过`)
