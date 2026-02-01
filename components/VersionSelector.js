import AppIcon from './AppIcon.js';

export default {
    components: { AppIcon },
    props: [
        'modelValue',
        'versionSearchQuery',
        'versionLang',
        'versionList',
        'versionShowBack',
        'filteredVersions',
        'isFetchingVersions',
        'activeVersion' 
    ],
    emits: [
        'update:modelValue',
        'update:versionSearchQuery',
        'update:versionLang',
        'refresh-versions',
        'update:versionShowBack',
        'select-version',
        'upload-custom'
    ],
    data() {
        return {
            backdropInteract: false,
            showSearchHelp: false,
            isDraggingOverModal: false
        }
    },
    mounted() {
        window.addEventListener('click', this.handleGlobalClick);
    },
    unmounted() {
        window.removeEventListener('click', this.handleGlobalClick);
    },
    methods: {
        handleGlobalClick(e) {
            if (!this.showSearchHelp) return;
            const menu = this.$refs.helpMenu;
            const input = this.$refs.searchInput;
            const toggle = this.$refs.helpToggle;
            if (menu && !menu.contains(e.target) && input && !input.contains(e.target) && toggle && !toggle.contains(e.target)) {
                this.showSearchHelp = false;
            }
        },
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
        },
        handleFileUpload(e) {
            const file = e.target.files[0];
            if (file) this.$emit('upload-custom', file);
        },
        handleDrop(e) {
            this.isDraggingOverModal = false;
            const file = e.dataTransfer.files[0];
            if (file) this.$emit('upload-custom', file);
        },
        onLangChange(e) {
            this.$emit('update:versionLang', e.target.value);
            this.$emit('refresh-versions');
        },

        //Check if this version is the one currently on the card
        checkActive(ver) {
            if (!this.activeVersion) return false;
            
            // If checking a Custom/Local card, compare the Image Source
            if (this.activeVersion.set === 'CUST' || this.activeVersion.set === 'Local') {
                return ver.fullSrc === this.activeVersion.src;
            }
            
            // Otherwise compare Set and Collector Number
            return ver.set === this.activeVersion.set && ver.cn === this.activeVersion.cn;
        }
    },
    template: /*html*/`
      <div
        v-if="modelValue"
        class="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50 backdrop-blur-sm transition-opacity"
        @mousedown="handleBackdropMouseDown"
        @click.self="close"
      >
        <div class="bg-surface border border-line rounded-xl shadow-2xl w-full max-w-5xl flex flex-col h-[85vh] transform transition-all scale-100 relative">
          
          <div
            v-if="isDraggingOverModal"
            class="absolute inset-0 bg-blue-500 bg-opacity-20 z-50 rounded-xl flex items-center justify-center border-4 border-blue-400 border-dashed pointer-events-none"
          >
            <div class="bg-surface p-6 rounded-xl shadow-lg">
              <p class="font-bold text-blue-600 text-lg">Drop to set custom art</p>
            </div>
          </div>

          <div class="p-6 border-b flex flex-col sm:flex-row justify-between items-start sm:items-center bg-secondary rounded-t-xl gap-4">
            <div class="flex flex-col sm:flex-row items-start sm:items-center gap-4 w-full">
              <div>
                <h3 class="text-xl font-bold text-primary">Select Version</h3>
                <p class="text-sm text-muted mt-1">Choose a printing.</p>
              </div>
              
              <div class="flex-1 w-full sm:w-auto relative flex gap-2 items-center">
                <div class="relative flex-1" ref="searchInput">
                  <input
                    type="text"
                    :value="versionSearchQuery"
                    @input="$emit('update:versionSearchQuery', $event.target.value)"
                    placeholder="Search (set:lea, frame:old...)"
                    class="w-full border border-line bg-surface text-primary rounded-lg pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                  <app-icon name="search" class="h-4 w-4 text-gray-400 absolute left-3 top-2.5"></app-icon>
                </div>

                <select
                  :value="versionLang"
                  @change="onLangChange"
                  class="border rounded-lg px-2 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-surface min-w-[100px]"
                >
                  <option value="en">English</option>
                  <option value="ja">Japanese</option>
                  <option value="ko">Korean</option>
                  <option value="ru">Russian</option>
                  <option value="zhs">Chinese (S)</option>
                  <option value="zht">Chinese (T)</option>
                  <option value="fr">French</option>
                  <option value="de">German</option>
                  <option value="it">Italian</option>
                  <option value="pt">Portuguese</option>
                  <option value="es">Spanish</option>
                  <option value="ph">Phyrexian</option>
                </select>

                <div class="tooltip-trigger relative">
                  <button
                    ref="helpToggle"
                    @click="showSearchHelp = !showSearchHelp"
                    class="w-8 h-8 rounded-full border border-line text-muted flex items-center justify-center hover:bg-gray-100 hover:text-indigo-600 transition-colors"
                  >
                    <span class="font-bold text-sm">?</span>
                  </button>
                  <div
                    v-if="showSearchHelp"
                    ref="helpMenu"
                    class="absolute top-10 right-0 z-50 w-72 bg-surface rounded-lg shadow-xl border border-line p-4 text-sm text-muted leading-relaxed"
                  >
                    <div class="flex justify-between items-center mb-2">
                      <h4 class="font-bold text-primary">Search Options</h4>
                      <button @click="showSearchHelp = false" class="text-gray-400 hover:text-muted">&times;</button>
                    </div>
                    <ul class="space-y-1">
                      <li><code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded">set:lea</code> (Set Code)</li>
                      <li><code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded">year:1995</code> (Release Year)</li>
                      <li><code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded">frame:old</code> (Old Frame)</li>
                      <li><code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded">border:black</code> (Border Color)</li>
                      <li><code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded">artist:guay</code> (Artist Name)</li>
                      <li><code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded">is:fullart</code> (Full Art)</li>
                      <li><code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded">is:textless</code> (Textless)</li>
                      <li><code class="bg-gray-100 dark:bg-gray-700 dark:text-gray-200 px-1 rounded">-set:sld</code> (Negate)</li>
                    </ul>
                  </div>
                </div>
              </div>

              <button
                v-if="versionList.some(v => v.backPreviewSrc)"
                @click="$emit('update:versionShowBack', !versionShowBack)"
                class="ml-auto sm:ml-0 text-xs font-bold bg-indigo-50 text-indigo-600 px-3 py-2 rounded-lg border border-indigo-100 hover:bg-indigo-100 hover:text-indigo-800 transition-colors flex items-center gap-2 whitespace-nowrap"
              >
                <app-icon name="auto-back" class="h-3 w-3"></app-icon>
                {{ versionShowBack ? 'Backs' : 'Fronts' }}
              </button>

              <button
                @click="$refs.customVersionInput.click()"
                class="text-xs font-bold bg-secondary text-primary px-3 py-2 rounded-lg border border-line hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors flex items-center gap-2 whitespace-nowrap"
              >
                <app-icon name="upload" class="h-3 w-3"></app-icon>
                Upload
              </button>
              <input
                type="file"
                ref="customVersionInput"
                accept="image/*"
                class="hidden"
                @change="handleFileUpload"
              />
            </div>
            
            <button @click="forceClose" class="text-gray-400 hover:text-muted absolute top-4 right-4 sm:static">
              <app-icon name="x" class="h-6 w-6"></app-icon>
            </button>
          </div>

          <div
            class="flex-1 overflow-y-auto p-6 bg-secondary"
            @dragover.prevent="isDraggingOverModal = true"
            @dragleave="isDraggingOverModal = false"
            @drop.prevent="handleDrop"
          >
            <div
              v-if="filteredVersions.length === 0 && !isFetchingVersions"
              class="flex flex-col items-center justify-center h-full text-muted"
            >
              <p class="mb-2">No versions match your search.</p>
              <p v-if="versionLang !== 'en'" class="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
                No cards found in {{ versionLang.toUpperCase() }}.
              </p>
            </div>

            <div
              v-if="filteredVersions.length > 0"
              class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6"
            >
              <div
                v-for="ver in filteredVersions"
                :key="ver.id"
                @click="$emit('select-version', ver)"
                class="cursor-pointer group flex flex-col gap-2 relative"
              >
                <div 
                  class="relative bg-surface rounded-lg shadow-sm group-hover:shadow-md transition-shadow overflow-hidden border border-line aspect-[63/88]"
                  :class="checkActive(ver) ? 'ring-4 ring-green-500 ring-offset-2 dark:ring-offset-gray-800' : 'group-hover:border-blue-400'"
                >
                  <img
                    :src="versionShowBack && ver.backPreviewSrc ? ver.backPreviewSrc : ver.previewSrc"
                    class="w-full h-full object-contain"
                    loading="lazy"
                  />
                  
                  <div v-if="checkActive(ver)" class="absolute top-0 right-0 bg-green-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-bl shadow-sm">
                    CURRENT
                  </div>

                  <div class="absolute inset-0 bg-blue-500 bg-opacity-0 group-hover:bg-opacity-10 transition-all"></div>
                  
                  <div v-if="ver.full_art || ver.textless" class="absolute bottom-1 right-1 flex flex-col gap-1 items-end">
                    <span v-if="ver.full_art" class="bg-black/70 text-white text-[9px] px-1 rounded">Full Art</span>
                    <span v-if="ver.textless" class="bg-black/70 text-white text-[9px] px-1 rounded">Textless</span>
                  </div>
                </div>
                
                <div class="text-center">
                  <div class="text-xs font-bold text-primary dark:text-gray-200 truncate px-1">
                    {{ ver.set }} #{{ ver.cn }}
                  </div>
                  <div class="text-[10px] text-muted truncate px-1" :title="ver.setName">
                    {{ ver.setName }}
                  </div>
                  <div class="text-[10px] text-gray-400">{{ ver.year }}</div>
                </div>
              </div>
            </div>

            <div v-if="isFetchingVersions" class="py-8 flex flex-col items-center justify-center text-muted">
              <div class="spinner border-line border-t-blue-600 w-8 h-8 mb-4"></div>
              <p>Loading more versions...</p>
            </div>
          </div>
        </div>
      </div>
    `
}