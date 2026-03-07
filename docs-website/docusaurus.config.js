// @ts-check

const { themes } = require('prism-react-renderer')
const lightTheme = themes.github
const darkTheme = themes.dracula

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'PomegranateDB',
  tagline: 'Reactive offline-first database for React Native & Expo',
  favicon: 'img/favicon.ico',

  url: 'https://bobbyquantum.github.io',
  baseUrl: '/pomegranate/',

  organizationName: 'bobbyquantum',
  projectName: 'pomegranate',

  trailingSlash: false,

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: require.resolve('./sidebars.js'),
          editUrl: 'https://github.com/bobbyquantum/pomegranate/edit/main/docs-website/',
          routeBasePath: '/',
          path: 'docs',
        },
        blog: false,
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/pomegranate-social-card.png',
      navbar: {
        title: 'PomegranateDB',
        logo: {
          alt: 'PomegranateDB Logo',
          src: 'img/logo.png',
        },
        items: [
          {
            type: 'doc',
            position: 'left',
            label: 'Docs',
            docId: 'getting-started',
          },
          {
            href: 'https://github.com/bobbyquantum/pomegranate',
            label: 'GitHub',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Learn',
            items: [
              { label: 'Getting Started', to: '/docs' },
              { label: 'Installation', to: '/installation' },
              { label: 'Schema & Models', to: '/schema' },
            ],
          },
          {
            title: 'Guides',
            items: [
              { label: 'CRUD Operations', to: '/crud' },
              { label: 'Queries', to: '/queries' },
              { label: 'Sync', to: '/sync' },
            ],
          },
          {
            title: 'More',
            items: [
              {
                label: 'GitHub',
                href: 'https://github.com/bobbyquantum/pomegranate',
              },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} PomegranateDB. Built with Docusaurus.`,
      },
      prism: {
        theme: lightTheme,
        darkTheme: darkTheme,
        additionalLanguages: ['bash', 'json', 'kotlin', 'java', 'groovy'],
      },
    }),
}

module.exports = config
