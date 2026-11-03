import React from "react";
import { staticFile } from "remotion";

export const GlobalFonts: React.FC = () => {
  return (
    <style>{`
      @font-face {
        font-family: 'Be Vietnam Pro';
        src: url('${staticFile("fonts/BeVietnamPro-Regular.ttf")}') format('truetype');
        font-weight: 400;
        font-style: normal;
        font-display: block;
      }
      @font-face {
        font-family: 'Be Vietnam Pro';
        src: url('${staticFile("fonts/BeVietnamPro-SemiBold.ttf")}') format('truetype');
        font-weight: 600;
        font-style: normal;
        font-display: block;
      }
      @font-face {
        font-family: 'Be Vietnam Pro';
        src: url('${staticFile("fonts/BeVietnamPro-Bold.ttf")}') format('truetype');
        font-weight: 700;
        font-style: normal;
        font-display: block;
      }
      @font-face {
        font-family: 'Be Vietnam Pro';
        src: url('${staticFile("fonts/BeVietnamPro-ExtraBold.ttf")}') format('truetype');
        font-weight: 800;
        font-style: normal;
        font-display: block;
      }
      @font-face {
        font-family: 'Be Vietnam Pro';
        src: url('${staticFile("fonts/BeVietnamPro-Black.ttf")}') format('truetype');
        font-weight: 900;
        font-style: normal;
        font-display: block;
      }

      * {
        font-family: 'Be Vietnam Pro', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        box-sizing: border-box;
      }
    `}</style>
  );
};
