import React from 'react';
import { Composition } from 'remotion';
import { MyComposition } from './Composition';
import { VideoEditor } from './VideoEditor';
import { ProductShowcase } from './ProductShowcase';
import { AppleStyleShowcase } from './AppleStyleShowcase';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="MyVideo"
        component={MyComposition}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="EditVideo"
        component={VideoEditor}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="ProductShowcase"
        component={ProductShowcase}
        durationInFrames={360}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="AppleStyle"
        component={AppleStyleShowcase}
        durationInFrames={510}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
