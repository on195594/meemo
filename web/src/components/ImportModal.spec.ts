import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import ImportModal from './ImportModal.vue';

vi.mock('../api/client', () => ({ api: { transfer: { importArchive: vi.fn() } } }));
enableAutoUnmount(afterEach);
beforeEach(() => vi.resetAllMocks());

describe('ImportModal', () => {
  it.each(['input', 'drop'])('selects an archive via %s and enables import', async (source) => {
    const wrapper = mount(ImportModal, { props: { modelValue: true } });
    expect((wrapper.get('.primary').element as HTMLButtonElement).disabled).toBe(true);
    const file = new File(['archive'], 'notes.tar');
    if (source === 'input') {
      const input = wrapper.get('input[type="file"]');
      Object.defineProperty(input.element, 'files', { value: [file] });
      await input.trigger('change');
    } else {
      await wrapper.get('.drop-zone').trigger('dragover');
      expect(wrapper.get('.drop-zone').classes()).toContain('dragging');
      await wrapper.get('.drop-zone').trigger('drop', { dataTransfer: { files: [file] } });
      expect(wrapper.get('.drop-zone').classes()).not.toContain('dragging');
    }
    expect(wrapper.get('.file-name').text()).toContain('notes.tar');
    expect((wrapper.get('.primary').element as HTMLButtonElement).disabled).toBe(false);
  });

  it('reports upload progress, prevents closing during import, and emits imported on success', async () => {
    let finish!: (value: { total: number; imported: number; failed: number }) => void;
    vi.mocked(api.transfer.importArchive).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const wrapper = mount(ImportModal, { props: { modelValue: true } });
    const file = new File(['archive'], 'notes.tar');
    await wrapper.get('.drop-zone').trigger('drop', { dataTransfer: { files: [file] } });
    await wrapper.get('.primary').trigger('click');
    expect(api.transfer.importArchive).toHaveBeenCalledExactlyOnceWith(file, expect.any(Function));
    vi.mocked(api.transfer.importArchive).mock.calls[0][1]!(42);
    await nextTick();
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('42');
    expect(wrapper.text()).toContain('Uploading archive... 42%');
    expect((wrapper.get('.secondary').element as HTMLButtonElement).disabled).toBe(true);
    await wrapper.get('[aria-label="Close modal"]').trigger('click');
    await wrapper.get('.modal-overlay').trigger('click');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(wrapper.emitted('imported')).toBeUndefined();
    vi.mocked(api.transfer.importArchive).mock.calls[0][1]!(100);
    await nextTick();
    expect(wrapper.text()).toContain('Extracting and verifying');
    finish({ total: 3, imported: 2, failed: 1 });
    await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toContain('Successfully imported 2 of 3 notes');
    expect(wrapper.emitted('imported')).toHaveLength(1);
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(false);
    await wrapper.get('.secondary').trigger('click');
    expect(wrapper.emitted('imported')).toHaveLength(1);
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]]);
  });

  it('shows import failures and allows retrying or closing', async () => {
    vi.mocked(api.transfer.importArchive).mockRejectedValue(new Error('Invalid archive'));
    const wrapper = mount(ImportModal, { props: { modelValue: true } });
    await wrapper.get('.drop-zone').trigger('drop', { dataTransfer: { files: [new File(['bad'], 'bad.tar')] } });
    await wrapper.get('.primary').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe('Invalid archive');
    expect(wrapper.emitted('imported')).toBeUndefined();
    expect((wrapper.get('.primary').element as HTMLButtonElement).disabled).toBe(false);
    await wrapper.get('.secondary').trigger('click');
    expect(wrapper.emitted('imported')).toBeUndefined();
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]]);
  });
});
