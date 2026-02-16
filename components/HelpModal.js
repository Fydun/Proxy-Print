import AppIcon from "./AppIcon.js";

export default {
  components: { AppIcon },
  props: ["modelValue", "storageUsage"],
  emits: ["update:modelValue", "clear-storage"],
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
                <li><strong>DFC Support:</strong> Print a different number of front and back sides, from different sets, or use the Duplex option for double-sided printing.</li>

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
            
            <div class="mt-6 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-100 dark:border-gray-600 text-xs text-gray-500 dark:text-gray-400">
              <p class="font-semibold mb-1">Privacy & Data Storage</p>
              <p class="mb-3">This application runs entirely in your browser. Your deck lists and custom images are stored on your device using IndexedDB. User settings are saved via LocalStorage. No data is transmitted to, processed by, or stored on any external server.</p>
              
              <p class="pt-3 border-t border-gray-200 dark:border-gray-600 italic">
                  Note: High-quality images for printing are cached automatically by your browser and will be cleared automatically if disk space is needed.
              </p>
            </div>
          </div>

          <div class="p-6 border-t dark:border-gray-700 bg-secondary rounded-b-xl flex justify-end">
            <button @click="forceClose" class="px-5 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors">
              Got it
            </button>
          </div>

        </div>
      </div>
    `,
};
