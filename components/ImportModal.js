import AppIcon from './AppIcon.js';

export default {
    components: { AppIcon },
    props: [
        'modelValue',          // Visibility
        'importText',          // The main text area content
        'importUrl',           // The URL input content
        'isFetchingUrl',       // Loading state for URL fetch
        'isImporting',         // Loading state for processing
        'importStatus',        // Status message text
        'importErrors',        // Array of error messages
        'detectedCardCount'    // Computed count of cards
    ],
    emits: [
        'update:modelValue',
        'update:importText',
        'update:importUrl',
        'clear-text',          // Action: Clear button
        'copy-text',           // Action: Copy button
        'import-url',          // Action: Import URL button
        'process-import',      // Action: Sync Deck button
        'clear-errors'         // Action: Close error box
    ],
    data() {
        return { backdropInteract: false }
    },
    methods: {
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
    template: /*html*/`
      <div
        v-if="modelValue"
        class="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50 backdrop-blur-sm transition-opacity"
        @mousedown="handleBackdropMouseDown"
        @click.self="close"
      >
        <div class="bg-surface border border-line rounded-xl shadow-2xl w-full max-w-2xl flex flex-col h-[85vh] transform transition-all scale-100">
          
          <div class="p-6 border-b flex justify-between items-center bg-secondary rounded-t-xl">
            <div>
              <h3 class="text-xl font-bold text-primary">Deck Editor</h3>
              <p class="text-sm text-muted mt-1">
                Edit your list below. Local files are preserved.
              </p>
            </div>
            <div class="flex items-center gap-2">
              <button
                @click="$emit('clear-text')"
                class="text-xs text-muted hover:text-red-500 font-medium px-2 py-1 rounded hover:bg-gray-100 transition-colors"
              >
                Clear
              </button>
              <button
                @click="$emit('copy-text')"
                class="text-xs text-muted hover:text-blue-500 font-medium px-2 py-1 rounded hover:bg-gray-100 transition-colors"
              >
                Copy
              </button>
              <div class="h-4 w-px bg-gray-300 mx-1"></div>
              <button @click="forceClose" class="text-gray-400 hover:text-muted">
                <app-icon name="x" class="h-6 w-6"></app-icon>
              </button>
            </div>
          </div>

          <div class="px-6 py-4 bg-secondary border-b flex gap-2">
            <input
              :value="importUrl"
              @input="$emit('update:importUrl', $event.target.value)"
              @keyup.enter="$emit('import-url')"
              type="text"
              placeholder="Paste Moxfield URL"
              class="flex-1 border border-line bg-surface text-primary rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            />
            <button
              @click="$emit('import-url')"
              :disabled="isFetchingUrl"
              class="bg-surface border border-line text-primary dark:text-gray-200 hover:bg-gray-100 font-bold py-2 px-4 rounded-lg text-sm transition-colors flex items-center gap-2"
            >
              <div v-if="isFetchingUrl" class="spinner border-gray-400 border-t-indigo-600 w-3 h-3"></div>
              <span>Import URL</span>
            </button>
          </div>

          <div class="flex-1 overflow-hidden flex flex-col p-0 relative">
            <div
              v-if="importErrors.length > 0"
              class="absolute top-4 left-4 right-4 z-10 p-3 bg-red-50 border border-red-200 rounded-lg shadow-sm text-sm text-red-800 flex flex-col gap-1 max-h-32 overflow-y-auto"
            >
              <div class="flex justify-between items-center font-bold">
                <span>Could not find {{ importErrors.length }} card(s):</span>
                <button @click="$emit('clear-errors')" class="text-red-500 hover:text-red-700">&times;</button>
              </div>
              <ul class="list-disc list-inside text-xs space-y-0.5">
                <li v-for="err in importErrors" :key="err" class="truncate">{{ err }}</li>
              </ul>
            </div>

            <textarea
              :value="importText"
              @input="$emit('update:importText', $event.target.value)"
              class="w-full h-full p-6 font-mono text-sm resize-none focus:outline-none focus:bg-blue-50/30 transition-colors leading-relaxed bg-surface text-primary"
              placeholder="4 Aether Vial (DST) 91&#10;Up the Beanstalk&#10;4x Goblin Welder"
              @keydown.ctrl.enter.prevent="$emit('process-import')"
              @keydown.meta.enter.prevent="$emit('process-import')"
            ></textarea>

            <div
              v-if="importStatus"
              class="absolute bottom-4 left-6 right-6 p-3 bg-indigo-50 text-indigo-700 rounded-lg text-sm flex items-center gap-3 shadow-sm border border-indigo-100"
            >
              <div v-if="isImporting" class="spinner border-indigo-300 border-t-indigo-700 w-4 h-4"></div>
              <span class="font-medium">{{ importStatus }}</span>
            </div>
          </div>

          <div class="p-5 border-t bg-secondary rounded-b-xl flex justify-between items-center">
            <div class="flex items-center gap-4">
              <div class="text-xs text-muted flex items-center gap-2">
                <span class="font-bold bg-line text-primary px-2 py-0.5 rounded">{{ detectedCardCount }}</span>cards detected
              </div>
            </div>
            <div class="flex gap-3">
              <button
                @click="forceClose"
                class="px-5 py-2 text-muted font-medium hover:bg-gray-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                @click="$emit('process-import')"
                :disabled="isImporting"
                class="px-6 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-md flex items-center gap-2"
              >
                <span>{{ isImporting ? 'Syncing...' : 'Sync Deck' }}</span>
                <app-icon v-if="!isImporting" name="swap" class="h-4 w-4"></app-icon>
              </button>
            </div>
          </div>

        </div>
      </div>
    `
}