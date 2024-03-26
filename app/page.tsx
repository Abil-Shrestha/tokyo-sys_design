import Image from "next/image";

export default function Home() {
  return (
    <main className=" flex flex-col justify-evenly text-white items-center p-24 text-3xl">
      <h1 className="font-sans py-12 text-6xl">Fonts and Gradients</h1>
      <div className="flex flex-row gap-4">
        <div className="p-20 font-array bg-gradient-to-b rounded-md from-[#c8d5bb] to [#47585c]">
          Sabi nezu
        </div>
        <div className="p-20 font-pramukh bg-gradient-to-r from-[#80989b] to [#d4dcda] rounded-md">
          Usuku mo nezu
        </div>
        <div className="p-20 font-melodrama bg-gradient-to-b from-[#4d80e6] to [#e5e4e6] rounded-md">
          Nezuogusa
        </div>
        <div className="p-20 font-sligoil bg-gradient-to-b from-[#c8d5bb] to [#47585c] rounded-md">
          Yanagi nezumi
        </div>
      </div>
    </main>
  );
}
