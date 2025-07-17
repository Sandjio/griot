import jsPDF from "jspdf";

/**
 * PDF Generator for Manga Episodes
 *
 * Creates PDF files combining episode text content with generated images
 * in a manga-style layout suitable for reading.
 */
export class PDFGenerator {
  private readonly pageWidth = 210; // A4 width in mm
  private readonly pageHeight = 297; // A4 height in mm
  private readonly margin = 20; // Margin in mm
  private readonly contentWidth = this.pageWidth - 2 * this.margin;
  private readonly contentHeight = this.pageHeight - 2 * this.margin;

  /**
   * Create PDF for manga episode with images and text
   */
  async createEpisodePDF(
    episodeContent: string,
    images: Array<{
      imageIndex: number;
      imageData: Buffer;
      prompt: string;
      filename: string;
    }>,
    metadata: {
      episodeId: string;
      episodeNumber: number;
      storyId: string;
      userId: string;
    }
  ): Promise<Buffer> {
    console.log("Creating episode PDF", {
      episodeId: metadata.episodeId,
      episodeNumber: metadata.episodeNumber,
      imageCount: images.length,
      contentLength: episodeContent.length,
    });

    try {
      // Initialize PDF document
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      // Parse episode content
      const parsedContent = this.parseEpisodeContent(episodeContent);

      // Add title page
      this.addTitlePage(pdf, parsedContent, metadata);

      // Add content pages with images
      await this.addContentPages(pdf, parsedContent, images);

      // Add metadata to PDF
      this.addPDFMetadata(pdf, parsedContent, metadata);

      // Generate PDF buffer
      const pdfBuffer = Buffer.from(pdf.output("arraybuffer"));

      console.log("Successfully created episode PDF", {
        episodeId: metadata.episodeId,
        pdfSize: pdfBuffer.length,
        pageCount: pdf.getNumberOfPages(),
      });

      return pdfBuffer;
    } catch (error) {
      console.error("Error creating episode PDF", {
        episodeId: metadata.episodeId,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new Error(
        `Failed to create episode PDF: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Parse episode content into structured format
   */
  private parseEpisodeContent(episodeContent: string): {
    title: string;
    content: string;
    scenes: Array<{
      text: string;
      hasImage: boolean;
      imageIndex?: number;
    }>;
  } {
    // Remove markdown metadata if present
    let content = episodeContent;
    if (content.startsWith("---")) {
      const endOfMetadata = content.indexOf("---", 3);
      if (endOfMetadata !== -1) {
        content = content.substring(endOfMetadata + 3).trim();
      }
    }

    // Extract title
    const lines = content.split("\n");
    let title = "Episode";
    let contentStartIndex = 0;

    // Look for title in first few lines
    for (let i = 0; i < Math.min(lines.length, 5); i++) {
      const line = lines[i].trim();
      if (line.startsWith("# ")) {
        title = line.substring(2).trim();
        contentStartIndex = i + 1;
        break;
      }
    }

    // Extract main content
    const mainContent = lines.slice(contentStartIndex).join("\n").trim();

    // Split content into scenes
    const scenes = this.splitIntoScenes(mainContent);

    return {
      title,
      content: mainContent,
      scenes,
    };
  }

  /**
   * Split content into scenes for image placement
   */
  private splitIntoScenes(content: string): Array<{
    text: string;
    hasImage: boolean;
    imageIndex?: number;
  }> {
    const scenes: Array<{
      text: string;
      hasImage: boolean;
      imageIndex?: number;
    }> = [];

    // Split by scene breaks or paragraphs
    const sceneBreakPatterns = [
      /\[Scene Break\]/i,
      /\[New Scene\]/i,
      /---/,
      /\*\*\*\*/,
    ];

    const paragraphs = content
      .split("\n\n")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    let currentScene = "";
    let imageIndex = 1;

    for (const paragraph of paragraphs) {
      // Check if this paragraph is a scene break
      const isSceneBreak = sceneBreakPatterns.some((pattern) =>
        pattern.test(paragraph)
      );

      if (isSceneBreak) {
        // Save current scene if it has content
        if (currentScene.trim().length > 0) {
          scenes.push({
            text: currentScene.trim(),
            hasImage: true,
            imageIndex: imageIndex++,
          });
        }
        currentScene = "";
        continue;
      }

      // Add paragraph to current scene
      currentScene += (currentScene ? "\n\n" : "") + paragraph;
    }

    // Add the last scene if it has content
    if (currentScene.trim().length > 0) {
      scenes.push({
        text: currentScene.trim(),
        hasImage: true,
        imageIndex: imageIndex++,
      });
    }

    // If no scenes were found, create scenes from paragraphs
    if (scenes.length === 0) {
      for (let i = 0; i < paragraphs.length; i += 2) {
        const sceneText = paragraphs.slice(i, i + 2).join("\n\n");
        scenes.push({
          text: sceneText,
          hasImage: i < 8, // Limit images to first 8 scenes
          imageIndex: i < 8 ? Math.floor(i / 2) + 1 : undefined,
        });
      }
    }

    return scenes;
  }

  /**
   * Add title page to PDF
   */
  private addTitlePage(
    pdf: jsPDF,
    content: { title: string },
    metadata: {
      episodeNumber: number;
      storyId: string;
    }
  ): void {
    // Set title font
    pdf.setFontSize(24);
    pdf.setFont("helvetica", "bold");

    // Add title
    const titleLines = pdf.splitTextToSize(content.title, this.contentWidth);
    const titleHeight = titleLines.length * 10;
    const titleY = (this.pageHeight - titleHeight) / 2;

    pdf.text(titleLines, this.margin, titleY);

    // Add episode info
    pdf.setFontSize(14);
    pdf.setFont("helvetica", "normal");
    pdf.text(
      `Episode ${metadata.episodeNumber}`,
      this.margin,
      titleY + titleHeight + 20
    );

    // Add creation date
    pdf.setFontSize(10);
    pdf.text(
      `Generated on ${new Date().toLocaleDateString()}`,
      this.margin,
      this.pageHeight - this.margin - 10
    );
  }

  /**
   * Add content pages with images and text
   */
  private async addContentPages(
    pdf: jsPDF,
    content: {
      scenes: Array<{
        text: string;
        hasImage: boolean;
        imageIndex?: number;
      }>;
    },
    images: Array<{
      imageIndex: number;
      imageData: Buffer;
      filename: string;
    }>
  ): Promise<void> {
    for (const scene of content.scenes) {
      // Add new page for each scene
      pdf.addPage();

      let currentY = this.margin;

      // Add image if available
      if (scene.hasImage && scene.imageIndex) {
        const image = images.find((img) => img.imageIndex === scene.imageIndex);
        if (image) {
          try {
            // Convert image buffer to base64 data URL
            const base64Image = image.imageData.toString("base64");
            const imageDataUrl = `data:image/png;base64,${base64Image}`;

            // Calculate image dimensions to fit in page
            const maxImageWidth = this.contentWidth;
            const maxImageHeight = this.contentHeight * 0.6; // Use 60% of page height for image

            // Add image to PDF
            pdf.addImage(
              imageDataUrl,
              "PNG",
              this.margin,
              currentY,
              maxImageWidth,
              maxImageHeight,
              undefined,
              "MEDIUM"
            );

            currentY += maxImageHeight + 10; // Add spacing after image
          } catch (imageError) {
            console.warn(`Failed to add image ${scene.imageIndex} to PDF`, {
              error:
                imageError instanceof Error
                  ? imageError.message
                  : String(imageError),
            });
            // Continue without the image
          }
        }
      }

      // Add scene text
      pdf.setFontSize(11);
      pdf.setFont("helvetica", "normal");

      const remainingHeight = this.pageHeight - currentY - this.margin;
      const textLines = pdf.splitTextToSize(scene.text, this.contentWidth);

      // Check if text fits on current page
      const textHeight = textLines.length * 5; // Approximate line height
      if (textHeight > remainingHeight) {
        // Split text across pages if needed
        let lineIndex = 0;
        while (lineIndex < textLines.length) {
          const availableHeight = this.pageHeight - currentY - this.margin;
          const linesPerPage = Math.floor(availableHeight / 5);

          if (linesPerPage <= 0) {
            pdf.addPage();
            currentY = this.margin;
            continue;
          }

          const pageLinesEnd = Math.min(
            lineIndex + linesPerPage,
            textLines.length
          );
          const pageLines = textLines.slice(lineIndex, pageLinesEnd);

          pdf.text(pageLines, this.margin, currentY);

          lineIndex = pageLinesEnd;

          if (lineIndex < textLines.length) {
            pdf.addPage();
            currentY = this.margin;
          }
        }
      } else {
        // Text fits on current page
        pdf.text(textLines, this.margin, currentY);
      }
    }
  }

  /**
   * Add metadata to PDF
   */
  private addPDFMetadata(
    pdf: jsPDF,
    content: { title: string },
    metadata: {
      episodeId: string;
      episodeNumber: number;
      storyId: string;
      userId: string;
    }
  ): void {
    // Set PDF properties
    pdf.setProperties({
      title: content.title,
      subject: `Manga Episode ${metadata.episodeNumber}`,
      author: "Manga Generation Platform",
      creator: "Manga Generation Platform",
      producer: "jsPDF",
      keywords: "manga, episode, generated",
    });
  }

  /**
   * Create simple text-only PDF (fallback when no images are available)
   */
  async createTextOnlyPDF(
    episodeContent: string,
    metadata: {
      episodeId: string;
      episodeNumber: number;
      storyId: string;
      userId: string;
    }
  ): Promise<Buffer> {
    console.log("Creating text-only episode PDF", {
      episodeId: metadata.episodeId,
      episodeNumber: metadata.episodeNumber,
    });

    try {
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      const parsedContent = this.parseEpisodeContent(episodeContent);

      // Add title page
      this.addTitlePage(pdf, parsedContent, metadata);

      // Add content pages (text only)
      pdf.addPage();
      pdf.setFontSize(11);
      pdf.setFont("helvetica", "normal");

      const textLines = pdf.splitTextToSize(
        parsedContent.content,
        this.contentWidth
      );
      let currentY = this.margin;

      for (let i = 0; i < textLines.length; i++) {
        if (currentY > this.pageHeight - this.margin - 10) {
          pdf.addPage();
          currentY = this.margin;
        }

        pdf.text(textLines[i], this.margin, currentY);
        currentY += 5;
      }

      // Add metadata
      this.addPDFMetadata(pdf, parsedContent, metadata);

      const pdfBuffer = Buffer.from(pdf.output("arraybuffer"));

      console.log("Successfully created text-only episode PDF", {
        episodeId: metadata.episodeId,
        pdfSize: pdfBuffer.length,
        pageCount: pdf.getNumberOfPages(),
      });

      return pdfBuffer;
    } catch (error) {
      console.error("Error creating text-only episode PDF", {
        episodeId: metadata.episodeId,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new Error(
        `Failed to create text-only episode PDF: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Validate PDF buffer
   */
  validatePDF(pdfBuffer: Buffer): boolean {
    // Check if buffer is not empty
    if (pdfBuffer.length === 0) {
      return false;
    }

    // Check PDF header
    const pdfHeader = "%PDF-";
    const headerString = pdfBuffer.subarray(0, 5).toString();
    if (headerString !== pdfHeader) {
      return false;
    }

    // Check minimum size (should be at least a few KB for a valid PDF)
    if (pdfBuffer.length < 1000) {
      return false;
    }

    return true;
  }
}
