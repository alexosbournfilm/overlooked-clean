const ToastAndroid = {
  SHORT: 'short',
  LONG: 'long',
  show: (msg) => { if (typeof window !== 'undefined') window.alert(msg); },
  showWithGravity: (msg) => { if (typeof window !== 'undefined') window.alert(msg); },
  showWithGravityAndOffset: (msg) => { if (typeof window !== 'undefined') window.alert(msg); },
};
export default ToastAndroid;
export { ToastAndroid };
