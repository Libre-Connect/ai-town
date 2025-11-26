import { BaseTexture, ISpritesheetData, Spritesheet } from 'pixi.js';
import { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatedSprite, Container, Graphics, Text, Sprite } from '@pixi/react';
import * as PIXI from 'pixi.js';

export const Character = ({
  textureUrl,
  spritesheetData,
  x,
  y,
  orientation,
  isMoving = false,
  isThinking = false,
  isSpeaking = false,
  emoji = '',
  isViewer = false,
  speed = 0.1,
  onClick,
  name,
  speechText,
  speechColor,
  speechImageUrl,
  speechStackIndex = 0,
}: {
  // Path to the texture packed image.
  textureUrl: string;
  // The data for the spritesheet.
  spritesheetData?: ISpritesheetData;
  // The pose of the NPC.
  x: number;
  y: number;
  orientation: number;
  isMoving?: boolean;
  // Shows a thought bubble if true.
  isThinking?: boolean;
  // Shows a speech bubble if true.
  isSpeaking?: boolean;
  emoji?: string;
  // Highlights the player.
  isViewer?: boolean;
  // The speed of the animation. Can be tuned depending on the side and speed of the NPC.
  speed?: number;
  onClick: () => void;
  name?: string;
  speechText?: string;
  speechColor?: number;
  speechImageUrl?: string;
  speechStackIndex?: number;
}) => {
  const [spriteSheet, setSpriteSheet] = useState<Spritesheet>();
  const makeGridSpritesheetData = async (url: string): Promise<ISpritesheetData> => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    await new Promise((res, rej) => {
      img.onload = () => res(null);
      img.onerror = (e) => rej(e);
    });
    const tileW = Math.floor(img.width / 3) || 32;
    const tileH = Math.floor(img.height / 4) || 32;
    const frame = (col: number, row: number) => ({ x: col * tileW, y: row * tileH, w: tileW, h: tileH });
    const frames: ISpritesheetData['frames'] = {
      left: { frame: frame(0, 1), sourceSize: { w: tileW, h: tileH }, spriteSourceSize: { x: 0, y: 0 } },
      left2: { frame: frame(1, 1), sourceSize: { w: tileW, h: tileH }, spriteSourceSize: { x: 0, y: 0 } },
      left3: { frame: frame(2, 1), sourceSize: { w: tileW, h: tileH }, spriteSourceSize: { x: 0, y: 0 } },
      right: { frame: frame(0, 2), sourceSize: { w: tileW, h: tileH }, spriteSourceSize: { x: 0, y: 0 } },
      right2: { frame: frame(1, 2), sourceSize: { w: tileW, h: tileH }, spriteSourceSize: { x: 0, y: 0 } },
      right3: { frame: frame(2, 2), sourceSize: { w: tileW, h: tileH }, spriteSourceSize: { x: 0, y: 0 } },
      up: { frame: frame(0, 3), sourceSize: { w: tileW, h: tileH }, spriteSourceSize: { x: 0, y: 0 } },
      up2: { frame: frame(1, 3), sourceSize: { w: tileW, h: tileH }, spriteSourceSize: { x: 0, y: 0 } },
      up3: { frame: frame(2, 3), sourceSize: { w: tileW, h: tileH }, spriteSourceSize: { x: 0, y: 0 } },
      down: { frame: frame(0, 0), sourceSize: { w: tileW, h: tileH }, spriteSourceSize: { x: 0, y: 0 } },
      down2: { frame: frame(1, 0), sourceSize: { w: tileW, h: tileH }, spriteSourceSize: { x: 0, y: 0 } },
      down3: { frame: frame(2, 0), sourceSize: { w: tileW, h: tileH }, spriteSourceSize: { x: 0, y: 0 } },
    } as any;
    return {
      frames,
      meta: { scale: '1' },
      animations: {
        left: ['left', 'left2', 'left3'],
        right: ['right', 'right2', 'right3'],
        up: ['up', 'up2', 'up3'],
        down: ['down', 'down2', 'down3'],
      },
    } as ISpritesheetData;
  };
  useEffect(() => {
    const parseSheet = async () => {
      const data = spritesheetData ?? (await makeGridSpritesheetData(textureUrl));
      const sheet = new Spritesheet(
        BaseTexture.from(textureUrl, {
          scaleMode: PIXI.SCALE_MODES.NEAREST,
        }),
        data,
      );
      await sheet.parse();
      setSpriteSheet(sheet);
    };
    void parseSheet();
  }, [textureUrl]);

  // The first "left" is "right" but reflected.
  const roundedOrientation = Math.floor(orientation / 90);
  const direction = ['right', 'down', 'left', 'up'][roundedOrientation];

  // Prevents the animation from stopping when the texture changes
  // (see https://github.com/pixijs/pixi-react/issues/359)
  const ref = useRef<PIXI.AnimatedSprite | null>(null);
  useEffect(() => {
    if (isMoving) {
      ref.current?.play();
    }
  }, [direction, isMoving]);

  if (!spriteSheet) return null;

  let blockOffset = { x: 0, y: 0 };
  switch (roundedOrientation) {
    case 2:
      blockOffset = { x: -20, y: 0 };
      break;
    case 0:
      blockOffset = { x: 20, y: 0 };
      break;
    case 3:
      blockOffset = { x: 0, y: -20 };
      break;
    case 1:
      blockOffset = { x: 0, y: 20 };
      break;
  }

  return (
    <Container x={x} y={y} interactive={true} pointerdown={onClick} cursor="pointer" sortableChildren={true}>
      {isThinking && (
        // TODO: We'll eventually have separate assets for thinking and speech animations.
        <Text x={-20} y={-10} scale={{ x: -0.8, y: 0.8 }} text={'💭'} anchor={{ x: 0.5, y: 0.5 }} />
      )}
      {isSpeaking && (
        // TODO: We'll eventually have separate assets for thinking and speech animations.
        <Text x={18} y={-10} scale={0.8} text={'💬'} anchor={{ x: 0.5, y: 0.5 }} />
      )}
      {isViewer && <ViewerIndicator />}
      <AnimatedSprite
        zIndex={10}
        ref={ref}
        isPlaying={isMoving}
        textures={spriteSheet.animations[direction]}
        animationSpeed={speed}
        anchor={{ x: 0.5, y: 0.5 }}
      />
      {emoji && (
        <Text zIndex={15} x={0} y={-24} scale={{ x: -0.8, y: 0.8 }} text={emoji} anchor={{ x: 0.5, y: 0.5 }} />
      )}
      {(speechText || speechImageUrl) && (
        (() => {
          const paddingX = 12;
          const paddingY = 10;
          const fontSize = 16;
          const w = 220;
          const imageH = speechImageUrl ? 90 : 0;
          const imageMargin = speechImageUrl ? 6 : 0;
          const style = new PIXI.TextStyle({
            fill: 0x000000,
            fontSize,
            fontWeight: '600',
            stroke: 0xffffff,
            strokeThickness: 0,
            wordWrap: true,
            wordWrapWidth: w - paddingX * 2,
            breakWords: true,
            lineHeight: fontSize + 4,
          });
          const metrics = PIXI.TextMetrics.measureText(speechText || '', style);
          const textHeight = speechText ? metrics.height : 0;
          const h = Math.max(
            fontSize + paddingY * 2,
            textHeight + paddingY * 2 + imageH + imageMargin,
          );
          const stackOffset = speechStackIndex * (h + 20);
          return (
            <Container x={0} y={-48 - stackOffset} zIndex={20}>
              <Graphics
                draw={(g) => {
                  g.clear();
                  g.beginFill(0xffffff, 0.95);
                  g.lineStyle(2, speechColor ?? 0x000000, 0.6);
                  g.drawRoundedRect(-w / 2, -h, w, h, 6);
                  g.endFill();
                }}
              />
              {speechText && (
                <Text
                  zIndex={21}
                  x={0}
                  y={speechImageUrl ? -h / 2 + paddingY : -h / 2}
                  text={speechText}
                  anchor={{ x: 0.5, y: speechImageUrl ? 0 : 0.5 }}
                  style={style}
                />
              )}
              {speechImageUrl && (
                <Sprite
                  image={speechImageUrl}
                  width={140}
                  height={90}
                  x={0}
                  y={speechText ? -h / 2 + (textHeight || fontSize) + imageMargin + 10 : -h / 2 + paddingY}
                  anchor={{ x: 0.5, y: 0 }}
                  scale={{ x: 1, y: 1 }}
                  zIndex={22}
                />
              )}
            </Container>
          );
        })()
      )}
      {name && (
        <Text
          zIndex={30}
          x={0}
          y={-16}
          text={name}
          anchor={{ x: 0.5, y: 0.5 }}
          style={new PIXI.TextStyle({ fill: 0xffffff, fontSize: 10, stroke: 0x000000, strokeThickness: 3 })}
        />
      )}
    </Container>
  );
};

function ViewerIndicator() {
  const draw = useCallback((g: PIXI.Graphics) => {
    g.clear();
    g.beginFill(0xffff0b, 0.5);
    g.drawRoundedRect(-10, 10, 20, 10, 100);
    g.endFill();
  }, []);

  return <Graphics draw={draw} />;
}
