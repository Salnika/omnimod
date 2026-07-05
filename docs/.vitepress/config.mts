import { defineConfig } from "vitepress";

export default defineConfig({
  base: "/omnimod/",
  title: "omnimod",
  description: "A modular, plugin-based codemod tool for TypeScript / JavaScript / React.",
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/introduction" },
      { text: "Plugins", link: "/plugins/styled-to-vanilla-extract" },
    ],
    logo: "/logo.png",
    sidebar: {
      "/guide/": [
        {
          text: "Guide",
          items: [
            { text: "Introduction", link: "/guide/introduction" },
            { text: "Getting started", link: "/guide/getting-started" },
            { text: "CLI", link: "/guide/cli" },
            { text: "Authoring a plugin", link: "/guide/authoring-plugins" },
          ],
        },
      ],
      "/plugins/": [
        {
          text: "Plugins",
          items: [
            {
              text: "styled-components → vanilla-extract",
              link: "/plugins/styled-to-vanilla-extract",
            },
            { text: "moment → dayjs", link: "/plugins/moment-to-dayjs" },
            { text: "jest → vitest", link: "/plugins/jest-to-vitest" },
            { text: "lodash → es-toolkit", link: "/plugins/lodash-to-es-toolkit" },
            { text: "redux → Redux Toolkit", link: "/plugins/redux-to-toolkit" },
            { text: "React class → hooks", link: "/plugins/react-class-to-hooks" },
            { text: "webpack → vite", link: "/plugins/webpack-to-vite" },
          ],
        },
      ],
    },
    socialLinks: [{ icon: "github", link: "https://github.com/salnika/omnimod" }],
    editLink: {
      pattern: "https://github.com/salnika/omnimod/edit/master/docs/:path",
    },
    search: { provider: "local" },
    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © 2026 salnika",
    },
  },
});
