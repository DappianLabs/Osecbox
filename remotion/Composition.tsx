import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';

export const MyComposition: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();

  const opacity = Math.min(1, frame / 30);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#000',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          fontSize: 100,
          color: '#fff',
          opacity,
          fontFamily: 'Arial, sans-serif',
        }}
      >
        Frame: {frame}
      </div>
    </AbsoluteFill>
  );
};
