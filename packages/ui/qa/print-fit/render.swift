import Foundation
import PDFKit
import AppKit

let directory = CommandLine.arguments[1]
for (name, expected) in [("split-fit", 2), ("translation-fit", 2), ("split-continuation", 12)] {
    let url = URL(fileURLWithPath: "\(directory)/\(name).pdf")
    guard let doc = PDFDocument(url: url) else { fatalError("Cannot load \(url)") }
    guard doc.pageCount == expected else { fatalError("\(name): \(doc.pageCount) pages, expected \(expected)") }
    for index in 0..<doc.pageCount {
        let page = doc.page(at: index)!
        let label = "p.\(index < 6 ? 1 : 2) (계속)"
        if name == "split-continuation" && index % 6 != 0 {
            guard page.string?.contains(label) == true else { fatalError("Missing continuation label on page \(index + 1)") }
        }
        let image = page.thumbnail(of: NSSize(width: 1400, height: 1400), for: .mediaBox)
        let representation = NSBitmapImageRep(data: image.tiffRepresentation!)!
        let png = representation.representation(using: .png, properties: [:])!
        try png.write(to: URL(fileURLWithPath: "\(directory)/\(name)-page\(index + 1).png"))
    }
    print("\(name): verified \(doc.pageCount) PDF pages")
}
