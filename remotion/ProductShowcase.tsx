import React from 'react';
import {
  AbsoluteFill,
  OffthreadVideo,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  Sequence,
  interpolate,
  spring,
  Easing,
} from 'remotion';

// Click effect component
const ClickEffect: React.FC<{ frame: number; x: number; y: number }> = ({ frame, x, y }) => {
  const scale = spring({
    frame,
    fps: 30,
    config: { damping: 20 },
  });

  const opacity = interpolate(frame, [0, 15], [1, 0], {
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: 60,
        height: 60,
        borderRadius: '50%',
        border: '4px solid #00ff88',
        transform: `translate(-50%, -50%) scale(${scale})`,
        opacity,
        pointerEvents: 'none',
      }}
    />
  );
};

// Particle effect
const Particle: React.FC<{ frame: number; delay: number; angle: number }> = ({
  frame,
  delay,
  angle,
}) => {
  const adjustedFrame = Math.max(0, frame - delay);
  
  const distance = interpolate(adjustedFrame, [0, 30], [0, 150], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  const opacity = interpolate(adjustedFrame, [0, 15, 30], [0, 1, 0]);

  const x = Math.cos(angle) * distance;
  const y = Math.sin(angle) * distance;

  return (
    <div
      style={{
        position: 'absolute',
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor: '#00ff88',
        transform: `translate(${x}px, ${y}px)`,
        opacity,
      }}
    />
  );
};

// Glitch effect overlay
const GlitchOverlay: React.FC<{ frame: number; active: boolean }> = ({ frame, active }) => {
  if (!active) return null;

  const offset = Math.sin(frame * 0.5) * 5;
  
  return (
    <>
      <AbsoluteFill
        style={{
          mixBlendMode: 'screen',
          opacity: 0.3,
          transform: `translateX(${offset}px)`,
        }}
      >
        <div style={{ width: '100%', height: '100%', backgroundColor: '#ff0000' }} />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          mixBlendMode: 'screen',
          opacity: 0.3,
          transform: `translateX(${-offset}px)`,
        }}
      >
        <div style={{ width: '100%', height: '100%', backgroundColor: '#00ffff' }} />
      </AbsoluteFill>
    </>
  );
};

export const ProductShowcase: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();

  // Dynamic zoom effect - zooms in and out throughout
  const zoomCycle = Math.sin(frame / 60) * 0.15 + 1.05;
  
  // Aggressive zoom in at specific moments
  const aggressiveZoom1 = interpolate(
    frame,
    [60, 90, 120, 150],
    [1, 1.3, 1, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.65, 0, 0.35, 1) }
  );

  const aggressiveZoom2 = interpolate(
    frame,
    [180, 210, 240, 270],
    [1, 1.4, 1, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.65, 0, 0.35, 1) }
  );

  const finalZoom = zoomCycle * aggressiveZoom1 * aggressiveZoom2;

  // Rotation for extra dynamism
  const rotation = Math.sin(frame / 120) * 2;

  // Click effects at specific frames
  const clickMoments = [
    { frame: 75, x: width * 0.3, y: height * 0.4 },
    { frame: 150, x: width * 0.7, y: height * 0.6 },
    { frame: 225, x: width * 0.5, y: height * 0.3 },
  ];

  // Intro animation
  const introOpacity = interpolate(frame, [0, 30], [0, 1], {
    extrapolateRight: 'clamp',
  });

  const introScale = spring({
    frame,
    fps,
    config: { damping: 15 },
  });

  // Vignette intensity
  const vignetteIntensity = interpolate(
    frame,
    [0, 60, 120, 180],
    [0.3, 0.5, 0.3, 0.6],
    { extrapolateRight: 'clamp' }
  );

  // Color overlay pulse
  const colorPulse = Math.sin(frame / 30) * 0.1 + 0.1;

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {/* Main video with zoom and rotation */}
      <AbsoluteFill
        style={{
          transform: `scale(${finalZoom}) rotate(${rotation}deg)`,
          opacity: introOpacity,
        }}
      >
        <OffthreadVideo
          src={staticFile('Product video raw.mp4')}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
          volume={0.7}
        />
      </AbsoluteFill>

      {/* Glitch effects at specific moments */}
      <GlitchOverlay frame={frame} active={frame >= 75 && frame <= 80} />
      <GlitchOverlay frame={frame} active={frame >= 150 && frame <= 155} />
      <GlitchOverlay frame={frame} active={frame >= 225 && frame <= 230} />

      {/* Color grading overlay */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(135deg, rgba(0,255,136,${colorPulse}), rgba(255,0,128,${colorPulse * 0.5}))`,
          mixBlendMode: 'overlay',
        }}
      />

      {/* Vignette effect */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at center, transparent 30%, rgba(0,0,0,${vignetteIntensity}) 100%)`,
        }}
      />

      {/* Click effects */}
      {clickMoments.map((click, i) => {
        const clickFrame = frame - click.frame;
        if (clickFrame >= 0 && clickFrame < 20) {
          return (
            <React.Fragment key={i}>
              <ClickEffect frame={clickFrame} x={click.x} y={click.y} />
              {/* Particle burst */}
              <div
                style={{
                  position: 'absolute',
                  left: click.x,
                  top: click.y,
                }}
              >
                {Array.from({ length: 12 }).map((_, particleIndex) => (
                  <Particle
                    key={particleIndex}
                    frame={clickFrame}
                    delay={0}
                    angle={(Math.PI * 2 * particleIndex) / 12}
                  />
                ))}
              </div>
            </React.Fragment>
          );
        }
        return null;
      })}

      {/* Intro title sequence */}
      <Sequence from={0} durationInFrames={90}>
        <AbsoluteFill
          style={{
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              fontSize: 120,
              fontWeight: 900,
              color: '#fff',
              textTransform: 'uppercase',
              letterSpacing: 8,
              textShadow: '0 0 30px rgba(0,255,136,0.8), 0 0 60px rgba(0,255,136,0.4)',
              transform: `scale(${introScale}) translateY(${interpolate(frame, [0, 30], [50, 0])})`,
              opacity: interpolate(frame, [0, 30, 60, 90], [0, 1, 1, 0]),
            }}
          >
            PRODUCT
          </div>
        </AbsoluteFill>
      </Sequence>

      {/* Feature callout 1 */}
      <Sequence from={100} durationInFrames={80}>
        <AbsoluteFill
          style={{
            justifyContent: 'center',
            alignItems: 'flex-start',
            padding: 60,
          }}
        >
          {(localFrame) => {
            const slideIn = spring({
              frame: localFrame,
              fps,
              config: { damping: 20 },
            });

            const x = interpolate(slideIn, [0, 1], [-400, 0]);

            return (
              <div
                style={{
                  transform: `translateX(${x}px)`,
                  backgroundColor: 'rgba(0,0,0,0.85)',
                  padding: 30,
                  borderLeft: '8px solid #00ff88',
                  backdropFilter: 'blur(10px)',
                }}
              >
                <h2
                  style={{
                    color: '#00ff88',
                    margin: 0,
                    fontSize: 48,
                    fontWeight: 800,
                    marginBottom: 10,
                  }}
                >
                  ⚡ LIGHTNING FAST
                </h2>
                <p style={{ color: '#fff', margin: 0, fontSize: 28 }}>
                  Blazing performance that scales
                </p>
              </div>
            );
          }}
        </AbsoluteFill>
      </Sequence>

      {/* Feature callout 2 */}
      <Sequence from={190} durationInFrames={80}>
        <AbsoluteFill
          style={{
            justifyContent: 'center',
            alignItems: 'flex-end',
            padding: 60,
          }}
        >
          {(localFrame) => {
            const slideIn = spring({
              frame: localFrame,
              fps,
              config: { damping: 20 },
            });

            const x = interpolate(slideIn, [0, 1], [400, 0]);

            return (
              <div
                style={{
                  transform: `translateX(${x}px)`,
                  backgroundColor: 'rgba(0,0,0,0.85)',
                  padding: 30,
                  borderRight: '8px solid #ff0080',
                  backdropFilter: 'blur(10px)',
                  textAlign: 'right',
                }}
              >
                <h2
                  style={{
                    color: '#ff0080',
                    margin: 0,
                    fontSize: 48,
                    fontWeight: 800,
                    marginBottom: 10,
                  }}
                >
                  🎯 PRECISION TOOLS
                </h2>
                <p style={{ color: '#fff', margin: 0, fontSize: 28 }}>
                  Built for professionals
                </p>
              </div>
            );
          }}
        </AbsoluteFill>
      </Sequence>

      {/* Feature callout 3 */}
      <Sequence from={280} durationInFrames={80}>
        <AbsoluteFill
          style={{
            justifyContent: 'flex-end',
            alignItems: 'center',
            padding: 60,
          }}
        >
          {(localFrame) => {
            const slideUp = spring({
              frame: localFrame,
              fps,
              config: { damping: 20 },
            });

            const y = interpolate(slideUp, [0, 1], [200, 0]);

            return (
              <div
                style={{
                  transform: `translateY(${y}px)`,
                  backgroundColor: 'rgba(0,0,0,0.85)',
                  padding: 30,
                  borderTop: '8px solid #ffaa00',
                  backdropFilter: 'blur(10px)',
                  width: '80%',
                  textAlign: 'center',
                }}
              >
                <h2
                  style={{
                    color: '#ffaa00',
                    margin: 0,
                    fontSize: 48,
                    fontWeight: 800,
                    marginBottom: 10,
                  }}
                >
                  🚀 NEXT-LEVEL SECURITY
                </h2>
                <p style={{ color: '#fff', margin: 0, fontSize: 28 }}>
                  Enterprise-grade protection
                </p>
              </div>
            );
          }}
        </AbsoluteFill>
      </Sequence>

      {/* Animated corner accents */}
      <AbsoluteFill>
        {/* Top left */}
        <div
          style={{
            position: 'absolute',
            top: 40,
            left: 40,
            width: interpolate(Math.sin(frame / 20), [-1, 1], [60, 80]),
            height: 4,
            backgroundColor: '#00ff88',
            boxShadow: '0 0 20px rgba(0,255,136,0.8)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 40,
            left: 40,
            width: 4,
            height: interpolate(Math.sin(frame / 20), [-1, 1], [60, 80]),
            backgroundColor: '#00ff88',
            boxShadow: '0 0 20px rgba(0,255,136,0.8)',
          }}
        />

        {/* Bottom right */}
        <div
          style={{
            position: 'absolute',
            bottom: 40,
            right: 40,
            width: interpolate(Math.sin(frame / 20 + Math.PI), [-1, 1], [60, 80]),
            height: 4,
            backgroundColor: '#ff0080',
            boxShadow: '0 0 20px rgba(255,0,128,0.8)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: 40,
            right: 40,
            width: 4,
            height: interpolate(Math.sin(frame / 20 + Math.PI), [-1, 1], [60, 80]),
            backgroundColor: '#ff0080',
            boxShadow: '0 0 20px rgba(255,0,128,0.8)',
          }}
        />
      </AbsoluteFill>

      {/* Scan line effect */}
      <div
        style={{
          position: 'absolute',
          top: (frame * 8) % height,
          left: 0,
          right: 0,
          height: 2,
          backgroundColor: 'rgba(0,255,136,0.3)',
          boxShadow: '0 0 10px rgba(0,255,136,0.6)',
        }}
      />

      {/* Outro sequence */}
      <Sequence from={durationInFrames - 90}>
        <AbsoluteFill
          style={{
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: `rgba(0,0,0,${interpolate(frame, [durationInFrames - 90, durationInFrames - 60], [0, 0.9])})`,
          }}
        >
          {(localFrame) => {
            const scale = spring({
              frame: localFrame,
              fps,
              config: { damping: 12 },
            });

            const textOpacity = interpolate(localFrame, [0, 30], [0, 1]);

            return (
              <>
                <div
                  style={{
                    fontSize: 100,
                    fontWeight: 900,
                    color: '#fff',
                    textTransform: 'uppercase',
                    letterSpacing: 12,
                    textShadow: '0 0 40px rgba(0,255,136,1), 0 0 80px rgba(0,255,136,0.5)',
                    transform: `scale(${scale})`,
                    opacity: textOpacity,
                    marginBottom: 30,
                  }}
                >
                  OSECBOX
                </div>
                <div
                  style={{
                    fontSize: 36,
                    color: '#00ff88',
                    opacity: interpolate(localFrame, [30, 60], [0, 1]),
                    letterSpacing: 4,
                  }}
                >
                  Security. Simplified.
                </div>
              </>
            );
          }}
        </AbsoluteFill>
      </Sequence>

      {/* Pulsing border effect */}
      <div
        style={{
          position: 'absolute',
          inset: 20,
          border: `3px solid rgba(0,255,136,${Math.sin(frame / 15) * 0.3 + 0.4})`,
          borderRadius: 8,
          pointerEvents: 'none',
          boxShadow: `inset 0 0 40px rgba(0,255,136,${Math.sin(frame / 15) * 0.2 + 0.2})`,
        }}
      />
    </AbsoluteFill>
  );
};
