module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        '@tamagui/babel-plugin',
        {
          config: './src/constants/tamagui.config.ts',
          components: ['tamagui'],
        },
      ],
    ],
  };
};