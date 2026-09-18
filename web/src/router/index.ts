import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import NotesView from '../views/NotesView.vue';
import PublicStreamView from '../views/PublicStreamView.vue';
import SharedNoteView from '../views/SharedNoteView.vue';
import PrivateNoteView from '../views/PrivateNoteView.vue';
import NotFoundView from '../views/NotFoundView.vue';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'notes',
    component: NotesView,
  },
  {
    path: '/public/:userId',
    name: 'public-stream',
    component: PublicStreamView,
  },
  {
    path: '/shared/:thingId',
    name: 'shared-note',
    component: SharedNoteView,
  },
  {
    path: '/note/:thingId',
    name: 'private-note',
    component: PrivateNoteView,
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: NotFoundView,
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
