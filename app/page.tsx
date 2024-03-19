import Image from "next/image";

export default function Home() {
  return (
    <main className="flex flex-row justify-evenly text-white items-center p-24">
      <div className="p-20 bg-gradient-to-b from-[#c8d5bb] to [#47585c]">
        Sabi nezu
      </div>
      <div className="p-20 bg-gradient-to-r from-[#80989b] to [#d4dcda]">
        Usuku mo nezu
      </div>
      <div className="p-20 bg-gradient-to-b from-[#4d80e6] to [#e5e4e6]">
        Nezuogusa
      </div>
      <div className="p-20 bg-gradient-to-b from-[#c8d5bb] to [#47585c]">
        Yanagi nezumi
      </div>
    </main>
  );
}
