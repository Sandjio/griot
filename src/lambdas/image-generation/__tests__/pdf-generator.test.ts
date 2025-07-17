import { PDFGenerator } from "../pdf-generator";
import jsPDF from "jspdf";

// Mock jsPDF
jest.mock("jspdf");

const mockJsPDF = jsPDF as jest.MockedClass<typeof jsPDF>;

describe("PDFGenerator", () => {
  let pdfGenerator: PDFGenerator;
  let mockPdfInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockPdfInstance = {
      setFontSize: jest.fn(),
      setFont: jest.fn(),
      splitTextToSize: jest.fn(),
      text: jest.fn(),
      addPage: jest.fn(),
      addImage: jest.fn(),
      output: jest.fn(),
      getNumberOfPages: jest.fn(),
      setProperties: jest.fn(),
    };

    mockJsPDF.mockImplementation(() => mockPdfInstance);
    pdfGenerator = new PDFGenerator();
  });

  describe("createEpisodePDF", () => {
    const mockEpisodeContent = `---
title: Test Episode
episodeNumber: 1
---

# Episode 1: The Beginning

This is the first scene with some action.

[Scene Break]

This is the second scene with dialogue.
"Hello, world!" said the character.

[Scene Break]

This is the final scene with conclusion.`;

    const mockImages = [
      {
        imageIndex: 1,
        imageData: Buffer.from("fake-image-data-1"),
        prompt: "Scene 1 description",
        filename: "image-001.png",
      },
      {
        imageIndex: 2,
        imageData: Buffer.from("fake-image-data-2"),
        prompt: "Scene 2 description",
        filename: "image-002.png",
      },
    ];

    const mockMetadata = {
      episodeId: "episode-123",
      episodeNumber: 1,
      storyId: "story-456",
      userId: "user-789",
    };

    const mockPDFBuffer = Buffer.from("fake-pdf-output");

    beforeEach(() => {
      mockPdfInstance.splitTextToSize.mockReturnValue(["Line 1", "Line 2"]);
      mockPdfInstance.output.mockReturnValue(mockPDFBuffer);
      mockPdfInstance.getNumberOfPages.mockReturnValue(3);
    });

    it("should create PDF with images and text", async () => {
      const result = await pdfGenerator.createEpisodePDF(
        mockEpisodeContent,
        mockImages,
        mockMetadata
      );

      expect(result).toEqual(mockPDFBuffer);
      expect(mockJsPDF).toHaveBeenCalledWith({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });
    });

    it("should add title page", async () => {
      await pdfGenerator.createEpisodePDF(
        mockEpisodeContent,
        mockImages,
        mockMetadata
      );

      // Check that title page elements were added
      expect(mockPdfInstance.setFontSize).toHaveBeenCalledWith(24);
      expect(mockPdfInstance.setFont).toHaveBeenCalledWith("helvetica", "bold");
      expect(mockPdfInstance.text).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Number),
        expect.any(Number)
      );
    });

    it("should add images to PDF", async () => {
      await pdfGenerator.createEpisodePDF(
        mockEpisodeContent,
        mockImages,
        mockMetadata
      );

      // Should add images for each scene
      expect(mockPdfInstance.addImage).toHaveBeenCalledTimes(2);
      expect(mockPdfInstance.addImage).toHaveBeenCalledWith(
        expect.stringContaining("data:image/png;base64,"),
        "PNG",
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
        undefined,
        "MEDIUM"
      );
    });

    it("should add content pages", async () => {
      await pdfGenerator.createEpisodePDF(
        mockEpisodeContent,
        mockImages,
        mockMetadata
      );

      // Should add pages for content
      expect(mockPdfInstance.addPage).toHaveBeenCalled();
      expect(mockPdfInstance.text).toHaveBeenCalled();
    });

    it("should set PDF metadata", async () => {
      await pdfGenerator.createEpisodePDF(
        mockEpisodeContent,
        mockImages,
        mockMetadata
      );

      expect(mockPdfInstance.setProperties).toHaveBeenCalledWith({
        title: "Episode 1: The Beginning",
        subject: "Manga Episode 1",
        author: "Manga Generation Platform",
        creator: "Manga Generation Platform",
        producer: "jsPDF",
        keywords: "manga, episode, generated",
      });
    });

    it("should handle content without metadata", async () => {
      const contentWithoutMetadata = `# Episode 1: Simple Title

Simple content without metadata.`;

      const result = await pdfGenerator.createEpisodePDF(
        contentWithoutMetadata,
        mockImages,
        mockMetadata
      );

      expect(result).toEqual(mockPDFBuffer);
    });

    it("should handle empty images array", async () => {
      const result = await pdfGenerator.createEpisodePDF(
        mockEpisodeContent,
        [],
        mockMetadata
      );

      expect(result).toEqual(mockPDFBuffer);
      expect(mockPdfInstance.addImage).not.toHaveBeenCalled();
    });

    it("should handle image addition errors gracefully", async () => {
      mockPdfInstance.addImage.mockImplementation(() => {
        throw new Error("Image addition failed");
      });

      // Should not throw error, just continue without the image
      const result = await pdfGenerator.createEpisodePDF(
        mockEpisodeContent,
        mockImages,
        mockMetadata
      );

      expect(result).toEqual(mockPDFBuffer);
    });

    it("should handle PDF creation errors", async () => {
      mockPdfInstance.output.mockImplementation(() => {
        throw new Error("PDF output failed");
      });

      await expect(
        pdfGenerator.createEpisodePDF(
          mockEpisodeContent,
          mockImages,
          mockMetadata
        )
      ).rejects.toThrow("Failed to create episode PDF: PDF output failed");
    });
  });

  describe("createTextOnlyPDF", () => {
    const mockEpisodeContent = `# Episode 1: Text Only

This is a simple episode with just text content.

No images will be included in this PDF.`;

    const mockMetadata = {
      episodeId: "episode-123",
      episodeNumber: 1,
      storyId: "story-456",
      userId: "user-789",
    };

    const mockPDFBuffer = Buffer.from("fake-text-pdf-output");

    beforeEach(() => {
      mockPdfInstance.splitTextToSize.mockReturnValue([
        "Line 1",
        "Line 2",
        "Line 3",
      ]);
      mockPdfInstance.output.mockReturnValue(mockPDFBuffer);
      mockPdfInstance.getNumberOfPages.mockReturnValue(2);
    });

    it("should create text-only PDF", async () => {
      const result = await pdfGenerator.createTextOnlyPDF(
        mockEpisodeContent,
        mockMetadata
      );

      expect(result).toEqual(mockPDFBuffer);
      expect(mockPdfInstance.addImage).not.toHaveBeenCalled();
    });

    it("should add title page for text-only PDF", async () => {
      await pdfGenerator.createTextOnlyPDF(mockEpisodeContent, mockMetadata);

      expect(mockPdfInstance.setFontSize).toHaveBeenCalledWith(24);
      expect(mockPdfInstance.setFont).toHaveBeenCalledWith("helvetica", "bold");
    });

    it("should handle text-only PDF creation errors", async () => {
      mockPdfInstance.output.mockImplementation(() => {
        throw new Error("Text PDF output failed");
      });

      await expect(
        pdfGenerator.createTextOnlyPDF(mockEpisodeContent, mockMetadata)
      ).rejects.toThrow(
        "Failed to create text-only episode PDF: Text PDF output failed"
      );
    });
  });

  describe("parseEpisodeContent", () => {
    it("should parse content with metadata", () => {
      const contentWithMetadata = `---
title: Test Episode
author: Test Author
---

# Episode 1: The Title

This is the main content.

[Scene Break]

Second scene content.`;

      const parsed = (pdfGenerator as any).parseEpisodeContent(
        contentWithMetadata
      );

      expect(parsed.title).toBe("Episode 1: The Title");
      expect(parsed.content).toContain("This is the main content");
      expect(parsed.scenes).toHaveLength(2);
    });

    it("should parse content without metadata", () => {
      const contentWithoutMetadata = `# Episode 2: Simple

Simple content without metadata.`;

      const parsed = (pdfGenerator as any).parseEpisodeContent(
        contentWithoutMetadata
      );

      expect(parsed.title).toBe("Episode 2: Simple");
      expect(parsed.content).toContain("Simple content without metadata");
    });

    it("should handle content without title", () => {
      const contentWithoutTitle = `Just some content without a title.

More content here.`;

      const parsed = (pdfGenerator as any).parseEpisodeContent(
        contentWithoutTitle
      );

      expect(parsed.title).toBe("Episode");
      expect(parsed.content).toContain("Just some content");
    });
  });

  describe("splitIntoScenes", () => {
    it("should split content by scene breaks", () => {
      const content = `First scene content.

[Scene Break]

Second scene content.

[New Scene]

Third scene content.`;

      const scenes = (pdfGenerator as any).splitIntoScenes(content);

      expect(scenes).toHaveLength(3);
      expect(scenes[0].text).toContain("First scene content");
      expect(scenes[1].text).toContain("Second scene content");
      expect(scenes[2].text).toContain("Third scene content");
      expect(scenes[0].hasImage).toBe(true);
      expect(scenes[0].imageIndex).toBe(1);
    });

    it("should split content by paragraphs when no scene breaks", () => {
      const content = `First paragraph.

Second paragraph.

Third paragraph.

Fourth paragraph.`;

      const scenes = (pdfGenerator as any).splitIntoScenes(content);

      expect(scenes.length).toBeGreaterThan(0);
      expect(scenes[0].text).toContain("First paragraph");
    });

    it("should handle empty content", () => {
      const scenes = (pdfGenerator as any).splitIntoScenes("");

      expect(scenes).toHaveLength(0);
    });
  });

  describe("validatePDF", () => {
    it("should validate correct PDF buffer", () => {
      const validPDFBuffer = Buffer.from("%PDF-1.4\n" + "x".repeat(1000));

      const isValid = pdfGenerator.validatePDF(validPDFBuffer);

      expect(isValid).toBe(true);
    });

    it("should reject empty buffer", () => {
      const emptyBuffer = Buffer.alloc(0);

      const isValid = pdfGenerator.validatePDF(emptyBuffer);

      expect(isValid).toBe(false);
    });

    it("should reject buffer without PDF header", () => {
      const invalidBuffer = Buffer.from("Not a PDF" + "x".repeat(1000));

      const isValid = pdfGenerator.validatePDF(invalidBuffer);

      expect(isValid).toBe(false);
    });

    it("should reject buffer that is too small", () => {
      const tinyBuffer = Buffer.from("%PDF-1.4");

      const isValid = pdfGenerator.validatePDF(tinyBuffer);

      expect(isValid).toBe(false);
    });
  });
});
