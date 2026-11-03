import { Config } from "@remotion/cli/config";

// Cấu hình GPU rendering tối ưu cho Windows
Config.setVideoImageFormat("jpeg");
Config.setPixelFormat("yuv420p");
Config.setCodec("h264");
Config.setOverwriteOutput(true);

// Cấu hình Webpack override
Config.overrideWebpackConfig((currentConfiguration) => {
  return currentConfiguration;
});
