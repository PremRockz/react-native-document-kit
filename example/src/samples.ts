import type {PreviewSource} from 'react-native-document-kit';

/**
 * Public files to try the preview and download with. Each has its own
 * cacheKey, so a file previewed once opens instantly next time (and the
 * Download button reuses it).
 */
export const SAMPLE_FILES: {label: string; source: PreviewSource}[] = [
  {
    label: 'PDF',
    source: {
      uri: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
      name: 'Sample.pdf',
      cacheKey: 'sample-pdf',
    },
  },
  {
    label: 'Image',
    source: {
      uri: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Fronalpstock_big.jpg/1280px-Fronalpstock_big.jpg',
      name: 'Mountains.jpg',
      cacheKey: 'sample-image',
    },
  },
  {
    label: 'Video (streamed)',
    source: {
      uri: 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_5MB.mp4',
      name: 'Big Buck Bunny.mp4',
    },
  },
  {
    label: 'Audio (streamed)',
    source: {
      uri: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
      name: 'SoundHelix Song 1.mp3',
    },
  },
  {
    label: 'Text',
    source: {
      uri: 'https://www.w3.org/TR/2003/REC-PNG-20031110/iso_8859-1.txt',
      name: 'Latin-1 table.txt',
      cacheKey: 'sample-text',
    },
  },
];
