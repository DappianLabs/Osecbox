import { AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig, Sequence } from 'remotion';

export const VideoEditor: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Calculate opacity for fade-in text overlay
  const textOpacity = Math.min(1, frame / 30);

  return (
    <AbsoluteFill>
      {/* Base video - put your video file in public/ folder */}
      <OffthreadVideo
        src={staticFile('your-video.mp4')}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
        }}
        // Trim first 2 seconds (60 frames at 30fps)
        trimBefore={60}
        // Adjust playback speed
        playbackRate={1}
        // Control volume
        volume={0.8}
      />

      {/* Text overlay that fades in */}
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          opacity: textOpacity,
        }}
      >
        <div
          style={{
            fontSize: 80,
            color: '#fff',
            fontWeight: 'bold',
            textShadow: '0 4px 8px rgba(0,0,0,0.8)',
            padding: 20,
            backgroundColor: 'rgba(0,0,0,0.5)',
            borderRadius: 10,
          }}
        >
          Your Text Overlay
        </div>
      </AbsoluteFill>

      {/* Animated shape overlay */}
      <AbsoluteFill
        style={{
          justifyContent: 'flex-end',
          alignItems: 'flex-end',
          padding: 40,
        }}
      >
        <div
          style={{
            width: 200,
            height: 200,
            backgroundColor: '#ff0080',
            borderRadius: '50%',
            opacity: 0.6,
            transform: `scale(${1 + Math.sin(frame / 20) * 0.2})`,
          }}
        />
      </AbsoluteFill>

      {/* Lower third text that appears after 3 seconds */}
      <Sequence from={90}>
        <AbsoluteFill
          style={{
            justifyContent: 'flex-end',
            padding: 40,
          }}
        >
          <div
            style={{
              backgroundColor: 'rgba(0,0,0,0.8)',
              padding: 20,
              borderLeft: '5px solid #00ff88',
            }}
          >
            <h2 style={{ color: '#fff', margin: 0, fontSize: 32 }}>
              Lower Third Title
            </h2>
            <p style={{ color: '#aaa', margin: 0, fontSize: 20 }}>
              Subtitle text here
            </p>
          </div>
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};
