import AppIcon from './AppIcon.js';

export default {
    // We register AppIcon locally so this component can use it
    components: { AppIcon },
    
    // We accept 'modelValue' (for v-model visibility) and 'settings' (the data)
    props: ['modelValue', 'settings'],
    
    // We tell the parent when we want to close
    emits: ['update:modelValue'],
    
    data() {
        return {
            backdropInteract: false
        }
    },
    
    methods: {
        // This ensures dragging from inside the modal to outside doesn't close it
        handleBackdropMouseDown(e) {
            this.backdropInteract = e.target === e.currentTarget;
        },
        close() {
            if (this.backdropInteract) {
                this.$emit('update:modelValue', false);
            }
            this.backdropInteract = false;
        },
        forceClose() {
            this.$emit('update:modelValue', false);
        }
    },

    // This is the HTML, cut and pasted inside backticks (`)
    template: /*html*/ ` 
      <div
        v-if="modelValue"
        class="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50 backdrop-blur-sm transition-opacity"
        @mousedown="handleBackdropMouseDown"
        @click.self="close"
      >
        <div class="bg-surface border border-line rounded-xl shadow-2xl w-full max-w-lg flex flex-col transform transition-all scale-100">
          
          <div class="p-6 border-b flex justify-between items-center bg-secondary rounded-t-xl">
            <h3 class="text-xl font-bold text-primary">Print Settings</h3>
            <button @click="forceClose" class="text-gray-400 hover:text-muted">
              <app-icon name="x" class="h-6 w-6"></app-icon>
            </button>
          </div>

          <div class="p-6 space-y-6">
            <div>
              <label class="block text-sm font-medium text-primary dark:text-gray-300 mb-2">Paper Format</label>
              <div class="flex gap-4">
                <label class="flex-1 cursor-pointer">
                  <input type="radio" v-model="settings.paperSize" value="a4" class="sr-only peer" />
                  <div class="border border-line rounded-lg p-3 text-center peer-checked:bg-blue-50 dark:peer-checked:bg-blue-900/30 peer-checked:border-blue-500 hover:bg-secondary transition-all">
                    <div class="font-bold text-primary dark:text-white">A4</div>
                    <div class="text-xs text-muted">210 x 297 mm</div>
                  </div>
                </label>
                <label class="flex-1 cursor-pointer">
                  <input type="radio" v-model="settings.paperSize" value="letter" class="sr-only peer" />
                  <div class="border border-line rounded-lg p-3 text-center peer-checked:bg-blue-50 dark:peer-checked:bg-blue-900/30 peer-checked:border-blue-500 hover:bg-secondary transition-all">
                    <div class="font-bold text-primary dark:text-white">US Letter</div>
                    <div class="text-xs text-muted">8.5 x 11 in</div>
                  </div>
                </label>
              </div>
            </div>

            <div>
              <label class="block text-sm font-medium text-primary dark:text-gray-300 mb-2">Card Standard</label>
              <select v-model="settings.cardPreset" class="w-full border border-line rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-surface text-primary mb-3">
                <option value="standard">Standard (Magic/Pokemon) - 63x88mm</option>
                <option value="yugioh">Japanese (Yu-Gi-Oh) - 59x86mm</option>
                <option value="mini_us">Mini American - 41x63mm</option>
                <option value="mini_eu">Mini European - 44x68mm</option>
                <option value="tarot">Tarot - 70x120mm</option>
                <option value="custom">Custom Dimensions...</option>
              </select>
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-xs font-medium text-muted mb-1">Width (mm)</label>
                  <input type="number" v-model.number="settings.cardWidth" :disabled="settings.cardPreset !== 'custom'" class="w-full border border-line rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-surface text-primary disabled:bg-gray-100 disabled:text-gray-400 dark:disabled:bg-gray-700 dark:disabled:text-gray-400 dark:disabled:border-gray-700 dark:disabled:opacity-80" />
                </div>
                <div>
                  <label class="block text-xs font-medium text-muted mb-1">Height (mm)</label>
                  <input type="number" v-model.number="settings.cardHeight" :disabled="settings.cardPreset !== 'custom'" class="w-full border border-line rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-surface text-primary disabled:bg-gray-100 disabled:text-gray-400 dark:disabled:bg-gray-700 dark:disabled:text-gray-400 dark:disabled:border-gray-700 dark:disabled:opacity-80" />
                </div>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-primary dark:text-gray-300 mb-1">Scaling (%)</label>
                <div class="relative">
                  <input type="number" v-model.number="settings.cardScale" step="1" min="10" max="200" class="w-full border border-line rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-surface text-primary pr-8" />
                  <span class="absolute right-3 top-2 text-gray-400 text-xs">%</span>
                </div>
              </div>
              <div>
                <label class="block text-sm font-medium text-primary dark:text-gray-300 mb-1">Gap Size (mm)</label>
                <input type="number" v-model.number="settings.gapSize" step="0.1" min="0" class="w-full border border-line rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-surface text-primary" />
              </div>
            </div>

            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-primary dark:text-gray-300 mb-1">Bleed (mm)</label>
                <input type="number" v-model.number="settings.bleedMm" step="0.5" min="0" class="w-full border border-line rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-surface text-primary" />
                <p class="text-[10px] text-gray-400 mt-1">Extends image past cut line.</p>
              </div>
              <div class="flex items-end">
                <label class="flex items-center gap-2 cursor-pointer pb-2">
                  <input type="checkbox" v-model="settings.proxyMarker" class="rounded text-blue-600 focus:ring-blue-500" />
                  <span class="text-sm text-primary dark:text-gray-300">Print 'PROXY' Marker</span>
                </label>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-primary dark:text-gray-300 mb-1">Background Fill</label>
                <select v-model="settings.pageBg" class="w-full border border-line rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-surface text-primary">
                  <option value="white">White</option>
                  <option value="black">Black (Fill corners)</option>
                </select>
              </div>
              <div>
                <label class="block text-sm font-medium text-primary dark:text-gray-300 mb-1">Cutting Guides</label>
                <select v-model="settings.cutMarks" class="w-full border border-line rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-surface text-primary">
                  <option value="none">None</option>
                  <option value="lines">Solid Lines</option>
                  <option value="dotted">Dotted Lines</option>
                  <option value="crosshairs">Crop Marks</option>
                </select>
              </div>
            </div>
          </div>

          <div class="p-6 border-t bg-secondary rounded-b-xl flex justify-end">
            <button @click="forceClose" class="px-5 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors">
              Done
            </button>
          </div>

        </div>
      </div>
    `
}