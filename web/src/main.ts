import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import './styles/tokens.css';
import { registerServiceWorker } from './utils/pwa';

const app = createApp(App);
app.use(router);
app.mount('#app');
registerServiceWorker();
