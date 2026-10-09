import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'notes',
    component: () => import('../views/NotesView.vue'),
  },
  {
    path: '/public/:userId',
    name: 'public-stream',
    component: () => import('../views/PublicStreamView.vue'),
  },
  {
    path: '/shared/:thingId',
    name: 'shared-note',
    component: () => import('../views/SharedNoteView.vue'),
  },
  {
    path: '/note/:thingId',
    name: 'private-note',
    component: () => import('../views/PrivateNoteView.vue'),
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('../views/NotFoundView.vue'),
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
