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

// Smooth cinematic text reveal
const CinematicText: React.FC<{
  children: React.ReactNode;
  delay?: number;
  duration?: number;
}> = ({ children, delay = 0, duration = 40 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const adjustedFrame = Math.max(0, frame - delay);

  const opacity = interpolate(adjustedFrame, [0, duration * 0.3], [0, 1], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  const y = interpolate(adjustedFrame, [0, duration * 0.5], [30, 0], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  const blur = interpolate(adjustedFrame, [0, duration * 0.3], [10, 0], {
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        opacity,
        transform: `translateY(${y}px)`,
        filter: `blur(${blur}px)`,
      }}
    >
      {children}
    </div>
  );
};

// Smooth scale animation for video
const useSmoothScale = (
  startFrame: number,
  endFrame: number,
  startScale: number,
  endScale: number
) => {
  const frame = useCurrentFrame();

  return interpolate(frame, [startFrame, endFrame], [startScale, endScale], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.33, 1, 0.68, 1), // Apple's signature easing
  });
};

export const AppleStyleShowcase: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();

  // Cinematic slow zoom throughout
  const globalZoom = interpolate(
    frame,
    [0, durationInFrames],
    [1, 1.15],
    { easing: Easing.inOut(Easing.ease) }
  );

  // Dramatic zoom moments
  const heroZoom = useSmoothScale(0, 120, 1.2, 1.0);
  const featureZoom1 = useSmoothScale(120, 180, 1.0, 1.08);
  const featureZoom2 = useSmoothScale(240, 300, 1.08, 1.0);
  const outroZoom = useSmoothScale(420, 480, 1.0, 1.25);

  const combinedZoom = globalZoom * heroZoom * featureZoom1 * featureZoom2 * outroZoom;

  // Smooth position shifts (Ken Burns effect)
  const xOffset = interpolate(
    frame,
    [0, durationInFrames],
    [0, -50],
    { easing: Easing.inOut(Easing.ease) }
  );

  const yOffset = interpolate(
    frame,
    [0, 240, 480],
    [0, -30, 0],
    { easing: Easing.inOut(Easing.ease) }
  );

  // Fade in from black
  const fadeIn = interpolate(frame, [0, 30], [0, 1], {
    extrapolateRight: 'clamp',
  });

  // Fade out to black
  const fadeOut = interpolate(frame, [durationInFrames - 30, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
  });

  const masterOpacity = Math.min(fadeIn, fadeOut);

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {/* Main video with cinematic zoom and pan */}
      <AbsoluteFill
        style={{
          opacity: masterOpacity,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            transform: `scale(${combinedZoom}) translate(${xOffset}px, ${yOffset}px)`,
            transformOrigin: 'center center',
          }}
        >
          <OffthreadVideo
            src={staticFile('Product video raw.mp4')}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
            volume={0.6}
          />
        </div>
      </AbsoluteFill>

      {/* Subtle vignette */}
      <AbsoluteFill
        style={{
          background: 'radial-gradient(circle at center, transparent 40%, rgba(0,0,0,0.4) 100%)',
          pointerEvents: 'none',
        }}
      />

      {/* Hero title - minimal, elegant */}
      <Sequence from={30} durationInFrames={90}>
        <AbsoluteFill
          style={{
            justifyContent: 'center',
            alignItems: 'center',
            pointerEvents: 'none',
          }}
        >
          <CinematicText delay={0} duration={50}>
            <h1
              style={{
                fontSize: 140,
                fontWeight: 700,
                color: '#fff',
                margin: 0,
                letterSpacing: -4,
                fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
                textAlign: 'center',
              }}
            >
              OsecBox
            </h1>
          </CinematicText>
        </AbsoluteFill>
      </Sequence>

      {/* Feature 1 - Clean, minimal */}
      <Sequence from={150} durationInFrames={90}>
        <AbsoluteFill
          style={{
            justifyContent: 'flex-end',
            alignItems: 'center',
            padding: 80,
            pointerEvents: 'none',
          }}
        >
          <CinematicText delay={0} duration={40}>
            <div style={{ textAlign: 'center' }}>
              <p
                style={{
                  fontSize: 72,
                  fontWeight: 600,
                  color: '#fff',
                  margin: 0,
                  marginBottom: 16,
                  letterSpacing: -2,
                  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
                }}
              >
                Lightning Fast
              </p>
              <p
                style={{
                  fontSize: 32,
                  fontWeight: 400,
                  color: 'rgba(255,255,255,0.7)',
                  margin: 0,
                  letterSpacing: -0.5,
                  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
                }}
              >
                Performance that scales with your needs
              </p>
            </div>
          </CinematicText>
        </AbsoluteFill>
      </Sequence>

      {/* Feature 2 - Right side */}
      <Sequence from={270} durationInFrames={90}>
        <AbsoluteFill
          style={{
            justifyContent: 'center',
            alignItems: 'flex-end',
            padding: 80,
            pointerEvents: 'none',
          }}
        >
          <CinematicText delay={0} duration={40}>
            <div style={{ textAlign: 'right', maxWidth: 600 }}>
              <p
                style={{
                  fontSize: 72,
                  fontWeight: 600,
                  color: '#fff',
                  margin: 0,
                  marginBottom: 16,
                  letterSpacing: -2,
                  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
                }}
              >
                Precision Tools
              </p>
              <p
                style={{
                  fontSize: 32,
                  fontWeight: 400,
                  color: 'rgba(255,255,255,0.7)',
                  margin: 0,
                  letterSpacing: -0.5,
                  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
                }}
              >
                Built for security professionals
              </p>
            </div>
          </CinematicText>
        </AbsoluteFill>
      </Sequence>

      {/* Feature 3 - Left side */}
      <Sequence from={390} durationInFrames={90}>
        <AbsoluteFill
          style={{
            justifyContent: 'center',
            alignItems: 'flex-start',
            padding: 80,
            pointerEvents: 'none',
          }}
        >
          <CinematicText delay={0} duration={40}>
            <div style={{ textAlign: 'left', maxWidth: 600 }}>
              <p
                style={{
                  fontSize: 72,
                  fontWeight: 600,
                  color: '#fff',
                  margin: 0,
                  marginBottom: 16,
                  letterSpacing: -2,
                  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
                }}
              >
                Enterprise Ready
              </p>
              <p
                style={{
                  fontSize: 32,
                  fontWeight: 400,
                  color: 'rgba(255,255,255,0.7)',
                  margin: 0,
                  letterSpacing: -0.5,
                  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
                }}
              >
                Security at scale
              </p>
            </div>
          </CinematicText>
        </AbsoluteFill>
      </Sequence>

      {/* Final tagline */}
      <Sequence from={450} durationInFrames={60}>
        <AbsoluteFill
          style={{
            justifyContent: 'center',
            alignItems: 'center',
            pointerEvents: 'none',
          }}
        >
          <CinematicText delay={0} duration={40}>
            <div style={{ textAlign: 'center' }}>
              <p
                style={{
                  fontSize: 56,
                  fontWeight: 500,
                  color: '#fff',
                  margin: 0,
                  letterSpacing: -1,
                  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
                }}
              >
                Security. Simplified.
              </p>
            </div>
          </CinematicText>
        </AbsoluteFill>
      </Sequence>

      {/* Subtle light leak effect */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(135deg, 
            rgba(255,255,255,${Math.sin(frame / 60) * 0.03 + 0.02}) 0%, 
            transparent 50%)`,
          mixBlendMode: 'overlay',
          pointerEvents: 'none',
        }}
      />
    </AbsoluteFill>
  );
};
