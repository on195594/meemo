<template>
  <div id="meemo-app">
    <header class="app-nav">
      <div class="nav-container">
        <router-link to="/" class="brand-logo">
          <img src="/favicon.png" alt="Meemo" class="logo-img" width="28" height="28" />
          <span>Meemo</span>
        </router-link>
        <nav class="nav-links">
          <router-link to="/" class="nav-item">Notes</router-link>
        </nav>
      </div>
    </header>

    <router-view />
  </div>
</template>

<script setup lang="ts">
// Top-level shell
</script>

<style>
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  background-color: #f7fafc;
  color: #2d3748;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  line-height: 1.6;
}

.app-nav {
  background-color: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  position: sticky;
  top: 0;
  z-index: 10;
}

.nav-container {
  max-width: 1000px;
  margin: 0 auto;
  padding: 0.75rem 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.brand-logo {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  text-decoration: none;
  color: #2b6cb0;
  font-size: 1.25rem;
  font-weight: 700;
}

.nav-links {
  display: flex;
  gap: 1rem;
}

.nav-item {
  text-decoration: none;
  color: #4a5568;
  font-weight: 500;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.nav-item:hover,
.nav-item.router-link-active {
  color: #2b6cb0;
}
</style>
