import AppIcon from "./AppIcon.js";

export default {
  components: { AppIcon },
  props: ["modelValue", "previewPages"],
  emits: ["update:modelValue"],
  data() {
    return { backdropInteract: false };
  },
  methods: {
    handleBackdropMouseDown(e) {
      this.backdropInteract = e.target === e.currentTarget;
    },
    close() {
      if (this.backdropInteract) {
        this.$emit("update:modelValue", false);
      }
      this.backdropInteract = false;
    },
    forceClose() {
      this.$emit("update:modelValue", false);
    },
  },
  template: /*html*/ `
      <div
        v-if="modelValue"
        class="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center p-4 z-50 backdrop-blur-sm transition-opacity"
        @mousedown="handleBackdropMouseDown"
        @click.self="close"
      >
        <div class="bg-gray-100 dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden">
          
          <div class="p-4 bg-surface border-b dark:border-gray-700 flex justify-between items-center">
            <h3 class="text-xl font-bold text-primary dark:text-white">Layout Preview</h3>
            <div class="flex items-center gap-4">
              <span class="text-sm text-muted dark:text-gray-400">Note: Low-res preview. Actual PDF is high quality.</span>
              <button @click="forceClose" class="text-gray-400 hover:text-muted dark:hover:text-gray-200">
                <app-icon name="x" class="h-6 w-6"></app-icon>
              </button>
            </div>
          </div>

          <div class="flex-1 overflow-y-auto p-8 flex flex-wrap justify-center gap-8 bg-gray-200 dark:bg-gray-900">
            <div
              v-for="(page, idx) in previewPages"
              :key="idx"
              class="bg-white shadow-lg relative"
              :style="{ width: page.w + 'px', height: page.h + 'px' }"
            >
<div class="absolute top-0 left-0 bg-white text-gray-800 border-r border-b border-gray-200 text-xs px-2 py-1 rounded-br z-10">
                Page {{ idx + 1 }}
              </div>

              <div
                v-for="item in page.items"
                :key="item.i"
                class="absolute bg-gray-100 overflow-hidden border border-gray-200"
                :style="{ left: item.x + 'px', top: item.y + 'px', width: item.w + 'px', height: item.h + 'px' }"
              >
                <img :src="item.src" loading="lazy" decoding="async" class="w-full h-full object-cover" />
              </div>
            </div>
          </div>

        </div>
      </div>
    `,
};
