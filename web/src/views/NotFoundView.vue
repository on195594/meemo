<template>
  <div class="not-found-view">
    <h1>404</h1>
    <p>The requested page or note was not found.</p>
    <router-link to="/" class="home-link">Go to Home</router-link>
  </div>
</template>

<style scoped>
.not-found-view {
  text-align: center;
  padding: 4rem 1.5rem;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
}
h1 {
  font-size: 4rem;
  color: #e53e3e;
  margin-bottom: 1rem;
}
p {
  color: #718096;
  font-size: 1.2rem;
  margin-bottom: 2rem;
}
.home-link {
  display: inline-block;
  background: #3182ce;
  color: #fff;
  padding: 0.5rem 1.25rem;
  border-radius: 6px;
  text-decoration: none;
}
.home-link:hover {
  background: #2b6cb0;
}
</style>
