# -*- coding: utf-8 -*-
"""
采集 B 站直播间观众/弹幕用户名，调用 Convex HTTP 接口 /http/presence_import 批量导入（随机形象与计划）。
"""
import asyncio
import contextlib
import http.cookies
import os
import sys
import time
from typing import Optional, Set, Dict, List

import aiohttp

import blivedm
import blivedm.models.web as web_models
from blivedm import handlers, models

# 在这里填入登录账号的 SESSDATA，避免用户名打码
SESSDATA = os.environ.get('BILI_SESSDATA', 'bdf921d3%2C1779595279%2C6c90c%2Ab1CjAhEq3EYm0bP80Fc3vyx6CsYzJACkV2bDS2vwT2nKkpOzJzAenp2yqvvztV4HAxax4SVnMtanA3cEJDcnNTUDZOYkk4cm43d0VXWVVMZHh1WmoxZmJmZXNIZ0Z6OURvMldPSlFvUlhqZURCcTYyX1doQmNsdDk0VGkwQno5NG02QzFFaTZ4M1p3IIEC')

def _parse_room_id(raw: str) -> int:
  try:
    return int(raw)
  except (TypeError, ValueError):
    return 0


ROOM_ID_ENV = os.environ.get('ROOM_ID', '1730460074')
ROOM_ID = _parse_room_id(sys.argv[1]) if len(sys.argv) > 1 else _parse_room_id(ROOM_ID_ENV)

# Convex 导入端点（可用环境变量覆盖，默认指向 /http/presence_import）
AI_TOWN_SERVER = os.environ.get('AI_TOWN_SERVER', 'https://superb-chinchilla-680.convex.cloud')
AI_TOWN_MUTATION = os.environ.get('AI_TOWN_MUTATION', '/http/presence_import')
if 'presenceSyncMutation' in AI_TOWN_MUTATION:
  # 兼容旧配置：自动切到新接口
  AI_TOWN_MUTATION = '/http/presence_import'
# 兼容旧默认（无 /http 前缀）写法
if AI_TOWN_MUTATION == '/presence_import':
  AI_TOWN_MUTATION = '/http/presence_import'
# 弹幕消息上报端点
AI_TOWN_DANMAKU = os.environ.get('AI_TOWN_DANMAKU', '/http/danmaku_message')
if AI_TOWN_DANMAKU == '/danmaku_message':
  AI_TOWN_DANMAKU = '/http/danmaku_message'
# worldId 可通过环境变量 AI_TOWN_WORLD_ID 传入；如果你有固定 worldId，可写成默认值
AI_TOWN_WORLD_ID = os.environ.get('AI_TOWN_WORLD_ID', 'm17et29rc7zejxa8jaeqjxzwh17w3n5j')
DEBUG_POST = os.environ.get('AI_TOWN_DEBUG', '0') == '1'
POST_INTERVAL_SECONDS = 2.0
FLUSH_INTERVAL_SECONDS = 0.25
EXIT_SECONDS = float(os.environ.get('AI_TOWN_EXIT_SECONDS', '120'))

PENDING_ENTER: Set[str] = set()
LAST_SEEN: Dict[str, float] = {}
LAST_POST: float = 0.0


def _mutation_url():
  if AI_TOWN_MUTATION.startswith('http://') or AI_TOWN_MUTATION.startswith('https://'):
    return AI_TOWN_MUTATION
  return f'{AI_TOWN_SERVER.rstrip("/")}{AI_TOWN_MUTATION}'

def _danmaku_url():
  if AI_TOWN_DANMAKU.startswith('http://') or AI_TOWN_DANMAKU.startswith('https://'):
    return AI_TOWN_DANMAKU
  return f'{AI_TOWN_SERVER.rstrip("/")}{AI_TOWN_DANMAKU}'


def _add_name(name: str):
  cleaned = (name or '').strip()
  if cleaned:
    now = time.time()
    LAST_SEEN[cleaned] = now
    PENDING_ENTER.add(cleaned)


def _collect_leaves(now: float):
  leaves: List[str] = []
  for uname, ts in list(LAST_SEEN.items()):
    if now - ts > EXIT_SECONDS:
      leaves.append(uname)
      LAST_SEEN.pop(uname, None)
  return leaves


class PresenceHandler(handlers.BaseHandler):
  # 进入房间
  def _on_interact_word_v2(self, client, message):
    if getattr(message, 'msg_type', None) == 1:
      _add_name(message.username)

  # 普通弹幕
  def _on_danmaku(self, client, message):
    _add_name(message.uname)
    asyncio.create_task(post_danmaku(client.session, message.uname, message.msg))

  # 开放平台弹幕
  def _on_open_live_danmaku(self, client, message):
    _add_name(message.uname)
    asyncio.create_task(post_danmaku(client.session, message.uname, message.msg))

  # 开放平台进房
def _on_open_live_enter_room(self, client, message):
  _add_name(message.uname)


async def post_batch(session: aiohttp.ClientSession):
  global LAST_POST
  now = time.time()
  leaves = _collect_leaves(now)
  enters = list(PENDING_ENTER)
  if not enters and not leaves:
    LAST_POST = now
    return
  if enters:
    PENDING_ENTER.clear()
  LAST_POST = now
  url = _mutation_url()
  payload = {'names': enters, 'leaves': leaves}
  if AI_TOWN_WORLD_ID:
    payload['worldId'] = AI_TOWN_WORLD_ID
  try:
    async with session.post(url, json=payload) as resp:
      body = await resp.text()
      if resp.status >= 400 or DEBUG_POST:
        print(f'presence_import POST {url} payload={payload} status={resp.status} body={body}')
  except Exception as e:
    print(f'Failed to post presence batch: {e}')

async def post_danmaku(session: aiohttp.ClientSession, name: str, text: str):
  url = _danmaku_url()
  payload = {'name': name, 'text': text}
  if AI_TOWN_WORLD_ID:
    payload['worldId'] = AI_TOWN_WORLD_ID
  try:
    async with session.post(url, json=payload) as resp:
      body = await resp.text()
      if resp.status >= 400 or DEBUG_POST:
        print(f'danmaku POST {url} payload={payload} status={resp.status} body={body}')
  except Exception as e:
    print(f'Failed to post danmaku: {e}')


async def presence_flush_loop(session: aiohttp.ClientSession):
  try:
    while True:
      await asyncio.sleep(FLUSH_INTERVAL_SECONDS)
      if time.time() - LAST_POST >= POST_INTERVAL_SECONDS:
        await post_batch(session)
  finally:
    await post_batch(session)


async def run_presence_importer(room_id: int):
  if room_id <= 0:
    raise SystemExit('ROOM_ID required for presence import')

  cookies = http.cookies.SimpleCookie()
  if SESSDATA:
    cookies['SESSDATA'] = SESSDATA
    cookies['SESSDATA']['domain'] = 'bilibili.com'

  async with aiohttp.ClientSession() as http_session:
    if SESSDATA:
      http_session.cookie_jar.update_cookies(cookies)
    client = blivedm.BLiveClient(room_id, session=http_session)
    client.set_handler(PresenceHandler())
    client.start()
    flush_task = asyncio.create_task(presence_flush_loop(http_session))
    try:
      await client.join()
    finally:
      client.stop()
      flush_task.cancel()
      with contextlib.suppress(asyncio.CancelledError):
        await flush_task
      await post_batch(http_session)
      await client.stop_and_close()


if __name__ == '__main__':
  if ROOM_ID > 0:
    asyncio.run(run_presence_importer(ROOM_ID))
  else:
    raise SystemExit('ROOM_ID required')
