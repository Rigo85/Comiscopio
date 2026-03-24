/**
 * Interface for archive extractors.
 * Each format (CBZ, CBR, CB7, PDF, folder) implements this.
 */
export interface Extractor {
  /** Extract the archive contents to the target directory */
  extract(sourcePath: string, targetDir: string): Promise<void>;
}
