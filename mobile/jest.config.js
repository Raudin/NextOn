/**
 * Jest configuration.
 *
 * `jest-expo` supplies the transform, the module map and the React Native
 * mocks, including its own carefully tuned `transformIgnorePatterns` — do not
 * override that here, or packages like `@react-native/jest-preset` stop being
 * transformed and the suite fails to start.
 *
 * Tests are limited on purpose to pure logic and storage seams: the schedule
 * date maths, the cache eviction rules, the change-log key parsing, the outbox
 * policy. Anything that renders a list or needs a native module is verified on
 * a device instead; mocking those would mostly test the mocks.
 */
module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  testMatch: ["<rootDir>/src/**/*.test.ts", "<rootDir>/src/**/*.test.tsx"],
};
