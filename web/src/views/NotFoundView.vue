<template>
  <div class="not-found-view">
    <h1>404</h1>
    <p>The requested page or note was not found.</p>
    <router-link to="/" class="home-link">Go to Home</router-link>
  </div>
</template>

<style scoped>
.not-found-view {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  max-width: 480px;
  margin: 4rem auto;
  padding: 3rem 1.5rem;
  background: var(--md-sys-color-surface-container-low);
  border-radius: var(--md-sys-shape-corner-2xl);
}
h1 {
  font-size: 4.5rem;
  font-weight: 400;
  line-height: 1;
  letter-spacing: -0.02em;
  color: var(--md-sys-color-primary);
  margin-bottom: 1rem;
}
p {
  color: var(--md-sys-color-on-surface-variant);
  font-size: var(--md-sys-typescale-body-large);
  margin-bottom: 2rem;
}
.home-link {
  display: inline-flex;
  align-items: center;
  min-height: 40px;
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
  padding: 0.5rem 1.5rem;
  border-radius: var(--md-sys-shape-corner-full);
  font-size: var(--md-sys-typescale-label-large);
  font-weight: 500;
  text-decoration: none;
  transition: box-shadow var(--md-sys-motion-duration-short) ease;
}
.home-link:hover {
  box-shadow: var(--md-sys-elevation-1);
}
</style>
