import Foundation
import AppKit
import PDFKit
let input=CommandLine.arguments[1], prefix=CommandLine.arguments[2]
guard let document=PDFDocument(url:URL(fileURLWithPath:input)) else {fatalError("Cannot open PDF")}
print("Pages: \(document.pageCount)")
for index in 0..<document.pageCount {
 guard let page=document.page(at:index) else {continue}
 let bounds=page.bounds(for:.mediaBox), image=NSImage(size:bounds.size)
 image.lockFocus()
 NSColor.white.setFill();NSBezierPath(rect:NSRect(origin:.zero,size:bounds.size)).fill()
 page.draw(with:.mediaBox,to:NSGraphicsContext.current!.cgContext)
 image.unlockFocus()
 let bitmap=NSBitmapImageRep(data:image.tiffRepresentation!)!
 try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:prefix+"-\(index+1).png"))
 try (page.string ?? "").write(toFile:prefix+"-\(index+1).txt",atomically:true,encoding:.utf8)
}
