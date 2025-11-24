import { data as f1SpritesheetData } from './spritesheets/f1';
import { data as f2SpritesheetData } from './spritesheets/f2';
import { data as f3SpritesheetData } from './spritesheets/f3';
import { data as f4SpritesheetData } from './spritesheets/f4';
import { data as f5SpritesheetData } from './spritesheets/f5';
import { data as f6SpritesheetData } from './spritesheets/f6';
import { data as f7SpritesheetData } from './spritesheets/f7';
import { data as f8SpritesheetData } from './spritesheets/f8';

export const Descriptions = [
  {
    name: '毒舌饭团',
    character: 'f1',
    identity:
      '美食区“毒舌博主”，嘴碎、挑剔、见不得吹牛，嗓门大、怼人不留情，但心软，偶尔主动道歉。',
    plan: '每天点评一家店，怼假宣传。',
  },
  {
    name: '杠上花',
    character: 'f2',
    identity:
      '典型“杠精程序员”，逮啥杠啥，逻辑严厉，语气生硬，偶尔抖机灵，遇到不懂装懂直接开怼。',
    plan: '把讨论带回事实与数据。',
  },
  {
    name: '街口大爷',
    character: 'f3',
    identity:
      '社区话事人，暴脾气但仗义直言，碰到插队、占道就开喷，嘴上不饶人，心里惦记街坊生活。',
    plan: '维护秩序，给街坊出主意。',
  },
  {
    name: '星火',
    character: 'f4',
    identity:
      '摇滚乐爱好者，性子急、话冲、爱抬杠，喜欢跟人辩风格与现场真不真，嘴硬但愿意认理。',
    plan: '组织一次小型演出。',
  },
  {
    name: '碎嘴小王',
    character: 'f5',
    identity:
      '段子手，插科打诨、嘴贫好斗，遇到装腔作势就阴阳怪气，敢怼也会自嘲，场面控。',
    plan: '写一条爆笑日常。',
  },
  {
    name: '直球阿豪',
    character: 'f6',
    identity:
      '工地师傅，直来直去、爱较真，脾气一上来就怼人，嫌弃拖延与甩锅，但讲规矩，认错痛快。',
    plan: '把工地流程梳理清楚。',
  },
  {
    name: '冷面法生',
    character: 'f7',
    identity:
      '法学院在读，冷面毒舌、观点强硬，争执时用法律条文怼人，口吻刻薄但不做人身攻击。',
    plan: '总结一份维权清单。',
  },
  {
    name: '刺头小李',
    character: 'f8',
    identity:
      '大学生，嘴硬心软，容易炸毛，听不得废话，吵起来三连问，事后能讲道理并愿意和解。',
    plan: '练习把情绪表达得更有分寸。',
  },
];

export const characters = [
  {
    name: 'f1',
    textureUrl: '/ai-town/assets/32x32folk.png',
    spritesheetData: f1SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f2',
    textureUrl: '/ai-town/assets/32x32folk.png',
    spritesheetData: f2SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f3',
    textureUrl: '/ai-town/assets/32x32folk.png',
    spritesheetData: f3SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f4',
    textureUrl: '/ai-town/assets/32x32folk.png',
    spritesheetData: f4SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f5',
    textureUrl: '/ai-town/assets/32x32folk.png',
    spritesheetData: f5SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f6',
    textureUrl: '/ai-town/assets/32x32folk.png',
    spritesheetData: f6SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f7',
    textureUrl: '/ai-town/assets/32x32folk.png',
    spritesheetData: f7SpritesheetData,
    speed: 0.1,
  },
  {
    name: 'f8',
    textureUrl: '/ai-town/assets/32x32folk.png',
    spritesheetData: f8SpritesheetData,
    speed: 0.1,
  },
];

// Characters move at 0.75 tiles per second.
export const movementSpeed = 0.75;
