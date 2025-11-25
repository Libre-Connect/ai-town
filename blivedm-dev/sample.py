# -*- coding: utf-8 -*-
"""
采集 B 站直播间观众/弹幕用户名，调用 Convex mutation presenceSyncMutation 批量同步进出。
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
SESSDATA = os.environ.get('BILI_SESSDATA', '')

def _parse_room_id(raw: str) -> int:
  try:
    return int(raw)
  except (TypeError, ValueError):
    return 0


ROOM_ID_ENV = os.environ.get('ROOM_ID', '0')
ROOM_ID = _parse_room_id(sys.argv[1]) if len(sys.argv) > 1 else _parse_room_id(ROOM_ID_ENV)

# Convex mutation 端点（默认指向 judicious-scorpion-568，可用环境变量覆盖）
AI_TOWN_SERVER = os.environ.get('AI_TOWN_SERVER', 'https://judicious-scorpion-568.convex.cloud')
AI_TOWN_MUTATION = os.environ.get(
  'AI_TOWN_MUTATION', '/api/mutation/aiTown/agentOperations:presenceSyncMutation'
)
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

  # 开放平台弹幕
  def _on_open_live_danmaku(self, client, message):
    _add_name(message.uname)

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
  payload = {'args': {'enter': enters, 'leave': leaves}}
  try:
    async with session.post(url, json=payload) as resp:
      body = await resp.text()
      if resp.status >= 400 or DEBUG_POST:
        print(f'presenceSyncMutation POST {url} payload={payload} status={resp.status} body={body}')
  except Exception as e:
    print(f'Failed to post presence batch: {e}')


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
