// web-shims/react-native-web-extended.js
// Pass-through everything from RN Web…
export * from 'react-native-web';
// …and add a safe ToastAndroid for web
export { ToastAndroid } from './ToastAndroid.web';
