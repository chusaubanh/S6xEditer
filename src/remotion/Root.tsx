import React from "react";
import { Composition, Folder } from "remotion";
import { FIXTURES } from "../fixtures";
import {
  calculateTrainingMetadata,
  TrainingVideoComposition,
  type TrainingVideoProps,
} from "./compositions/TrainingVideoComposition";

const emptyProps: TrainingVideoProps = { script: null, timeline: null, hideText: false };

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="TrainingVideo"
        component={TrainingVideoComposition}
        calculateMetadata={calculateTrainingMetadata}
        durationInFrames={1}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={emptyProps}
      />
      {/* Chỉ để kiểm tra máy móc, không phải nội dung. */}
      <Folder name="Fixtures">
        {FIXTURES.map((fixture) => (
          <Composition key={fixture.id} id={fixture.id} component={fixture.component} durationInFrames={90} fps={30} width={720} height={720} />
        ))}
      </Folder>
    </>
  );
};
