import AppIcon from './AppIcon.js';

export default {
    components: { AppIcon },
    props: ['modelValue'],
    emits: ['update:modelValue'],
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
        <div class="bg-surface rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[85vh] transform transition-all scale-100">
          
          <div class="p-6 border-b dark:border-gray-700 flex justify-between items-center bg-secondary rounded-t-xl">
            <h3 class="text-xl font-bold text-primary dark:text-white">
              How to Use & Features
            </h3>
            <button @click="forceClose" class="text-gray-400 hover:text-muted dark:hover:text-gray-200">
              <app-icon name="x" class="h-6 w-6"></app-icon>
            </button>
          </div>

          <div class="p-6 overflow-y-auto text-sm text-muted dark:text-gray-300 space-y-4">
            <div>
              <h4 class="font-bold text-primary dark:text-white mb-2 text-lg">Getting Cards</h4>
              <ul class="list-disc pl-5 space-y-1">
                <li><strong>Paste Text:</strong> Click "Edit Deck" and paste a list (e.g., "4 Lightning Bolt").</li>
                <li><strong>Import URL:</strong> Paste a Moxfield deck URL in the "Edit Deck" menu.</li>
                <li><strong>Drag & Drop:</strong> Drag card image files directly onto the webpage from your computer.</li>
                <li><strong>Automatic Info:</strong> The app automatically finds Scryfall data for local images based on filename.</li>
              </ul>
            </div>
            <hr class="dark:border-gray-600" />
            <div>
              <h4 class="font-bold text-primary dark:text-white mb-2 text-lg">Customization</h4>
              <ul class="list-disc pl-5 space-y-1">
                <li><strong>Change Version:</strong> Click any card to swap art/set or language.</li>
                <li><strong>Custom Art:</strong> In the version selector, click "Upload" or drag an image onto the modal.</li>
                <li><strong>Mass Edit:</strong> Use the "Select All" checkbox or click checkboxes on cards to change language or delete in bulk.</li>
              </ul>
            </div>
            <hr class="dark:border-gray-600" />
            <div>
              <h4 class="font-bold text-primary dark:text-white mb-2 text-lg">Printing</h4>
              <ul class="list-disc pl-5 space-y-1">
                <li><strong>Sorting:</strong> Use the "Sort" dropdown to organize by Color, Mana Value, etc. (Lands/Colorless sort by identity).</li>
                <li><strong>Duplex:</strong> Enable the "Duplex" toggle to generate a PDF with backs aligned for double-sided printing.</li>
                <li><strong>Settings:</strong> Click the gear icon to change Paper Size (A4/Letter), Cut Lines, or Bleed.</li>
              </ul>
            </div>
            <div class="mt-6 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-100 dark:border-gray-600 text-xs text-gray-500 dark:text-gray-400">
              <p class="font-semibold mb-1">Privacy & Data Storage</p>
              <p>This application runs entirely in your browser. Your deck lists and settings are stored in your browser's Local Storage so you don't lose your work. No personal data is collected, tracked, or sent to any external server.</p>
            </div>
          </div>

          <div class="p-6 border-t dark:border-gray-700 bg-secondary rounded-b-xl flex justify-end">
            <button @click="forceClose" class="px-5 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors">
              Got it
            </button>
          </div>

        </div>
      </div>
    `
}