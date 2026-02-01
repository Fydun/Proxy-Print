import AppIcon from "./AppIcon.js";

export default {
  // We register AppIcon locally so this component can use it
  components: { AppIcon },

  // We accept 'modelValue' (for v-model visibility) and 'previewPages' (the data)
  props: ["modelValue", "previewPages"],

  // We tell the parent when we want to close
  emits: ["update:modelValue"],

  data() {
    return {
      backdropInteract: false,
    };
  },

  methods: {
    // This ensures dragging from inside the modal to outside doesn't close it
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

  // This is the HTML, cut and pasted inside backticks (`)
  template: /*html*/ `
<div
        v-if="modelValue"
        class="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center p-4 z-50 backdrop-blur-sm transition-opacity"
        @mousedown="handleBackdropMouseDown"
        @click.self="close"
      >
        <div class="bg-gray-100 rounded-xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden">
          
          <div class="p-4 bg-surface border-b flex justify-between items-center">
            <h3 class="text-xl font-bold text-primary">Layout Preview</h3>
            <div class="flex items-center gap-4">
              <span class="text-sm text-muted">Note: Low-res preview. Actual PDF is high quality.</span>
              <button @click="forceClose" class="text-gray-400 hover:text-muted">
                <app-icon name="x" class="h-6 w-6"></app-icon>
              </button>
            </div>
          </div>

          <div class="flex-1 overflow-y-auto p-8 flex flex-wrap justify-center gap-8 bg-gray-200">
            <div
              v-for="(page, idx) in previewPages"
              :key="idx"
              class="bg-surface shadow-lg relative transition-transform hover:scale-[1.02]"
              :style="{ width: page.w + 'px', height: page.h + 'px' }"
            >
              <div class="absolute top-0 left-0 bg-gray-800 text-white text-xs px-2 py-1 rounded-br">
                Page {{ idx + 1 }}
              </div>
              <div
                v-for="item in page.items"
                :key="item.i"
                class="absolute bg-gray-100 overflow-hidden border border-line"
                :style="{ left: item.x + 'px', top: item.y + 'px', width: item.w + 'px', height: item.h + 'px' }"
              >
                <img :src="item.src" class="w-full h-full object-cover" />
              </div>
            </div>
          </div>

        </div>
      </div>
    `,
};
