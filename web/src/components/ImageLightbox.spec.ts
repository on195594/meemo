import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ImageLightbox from './ImageLightbox.vue';

const sampleImages = [
  { src: '/images/pic1.jpg', alt: 'First Image', title: 'Picture 1' },
  { src: '/images/pic2.png', alt: 'Second Image', title: 'Picture 2' },
];

describe('ImageLightbox', () => {
  it('does not render dialog content when closed', () => {
    const wrapper = mount(ImageLightbox, {
      props: {
        open: false,
        images: sampleImages,
      },
    });

    expect(wrapper.find('.lightbox-overlay').exists()).toBe(false);
  });

  it('renders image, title, and counter when open', () => {
    const wrapper = mount(ImageLightbox, {
      props: {
        open: true,
        images: sampleImages,
        initialIndex: 0,
      },
    });

    const img = document.querySelector('.lightbox-img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('/images/pic1.jpg');
    expect(document.querySelector('.lightbox-counter')?.textContent).toContain('1 / 2');
    expect(document.querySelector('.lightbox-title')?.textContent).toContain('Picture 1');
    wrapper.unmount();
  });

  it('navigates next and previous image', async () => {
    const wrapper = mount(ImageLightbox, {
      props: {
        open: true,
        images: sampleImages,
        initialIndex: 0,
      },
    });

    const nextBtn = document.querySelector('.next-btn') as HTMLButtonElement;
    expect(nextBtn).not.toBeNull();
    nextBtn.click();
    await flushPromises();

    const img = document.querySelector('.lightbox-img');
    expect(img?.getAttribute('src')).toBe('/images/pic2.png');
    expect(document.querySelector('.lightbox-counter')?.textContent).toContain('2 / 2');

    const prevBtn = document.querySelector('.prev-btn') as HTMLButtonElement;
    prevBtn.click();
    await flushPromises();
    expect(document.querySelector('.lightbox-img')?.getAttribute('src')).toBe('/images/pic1.jpg');
    wrapper.unmount();
  });

  it('emits close event on close button click and Escape key', async () => {
    const wrapper = mount(ImageLightbox, {
      props: {
        open: true,
        images: sampleImages,
      },
    });

    const closeBtn = document.querySelector('.close-btn') as HTMLButtonElement;
    closeBtn.click();
    await flushPromises();

    expect(wrapper.emitted('close')).toHaveLength(1);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(wrapper.emitted('close')).toHaveLength(2);
    wrapper.unmount();
  });
});
